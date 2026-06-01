import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../services/api.service';
import type { RuleDefinition } from '../models';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="page-title">
      <div>
        <p>Rules</p>
        <h1>Compliance rule catalog</h1>
        <p class="page-copy">DAF logic is stored as database rules and used by the PRF/SORF/SRF engine.</p>
      </div>
      <div class="toolbar">
        <button class="button secondary" (click)="syncRules()" [disabled]="busy">{{ busy ? 'Syncing' : 'Sync DB Rules' }}</button>
      </div>
    </section>

    <section class="panel catalog-tools">
      <label class="field">
        <span>Filter</span>
        <input [(ngModel)]="filter" placeholder="R001, Canada, approval, manual">
      </label>
      <div class="rule-totals">
        <span class="tag info">{{ loading ? 'Checking' : rules.length + ' definitions' }}</span>
        <span class="tag good">{{ loading ? 'Checking' : executableCount + ' executable' }}</span>
        <span class="tag warn">{{ loading ? 'Checking' : manualCount + ' guided/manual' }}</span>
      </div>
    </section>

    @if (message) {
      <div class="alert info catalog-message">{{ message }}</div>
    }

    @if (loading) {
      <div class="panel empty">Loading rule catalog.</div>
    } @else if (error) {
      <div class="alert bad catalog-message">{{ error }}</div>
    } @else {
      <section class="panel rules-table">
        <div class="rule-row table-head">
          <span>Rule</span>
          <span>Scope</span>
          <span>Variants</span>
          <span>Status</span>
          <span>Logic</span>
        </div>
        @for (rule of filteredRules; track rule.ruleId) {
          <div class="rule-row">
            <div>
              <strong>{{ rule.ruleId }}</strong>
              <small>{{ rule.ruleGroup || 'Ungrouped' }}</small>
            </div>
            <div>
              <span>{{ rule.businessScope || 'All' }}</span>
              <small>{{ rule.requestTypes.join(', ') || 'All types' }}</small>
            </div>
            <div>
              <span>{{ executableFor(rule) }} executable</span>
              <small>{{ rule.variants.length }} total</small>
            </div>
            <div>
              <span [class]="rule.automationLevel === 'alpha' ? 'tag good' : rule.automationLevel === 'guided' ? 'tag warn' : 'tag info'">{{ rule.automationLevel }}</span>
            </div>
            <div class="logic-cell">{{ firstDescription(rule) }}</div>
          </div>
        } @empty {
          <div class="empty">No rules matched that filter.</div>
        }
      </section>
    }
  `,
  styles: [
    `
      .catalog-tools {
        display: flex;
        flex-wrap: wrap;
        align-items: end;
        justify-content: space-between;
        gap: 0.9rem;
        padding: 0.9rem;
      }

      .catalog-tools .field {
        flex: 1 1 320px;
      }

      .rule-totals {
        display: flex;
        flex-wrap: wrap;
        gap: 0.45rem;
      }

      .catalog-message {
        margin-top: 0.85rem;
      }

      .rules-table {
        margin-top: 0.85rem;
        overflow: hidden;
      }

      .rule-row {
        display: grid;
        grid-template-columns: 110px 1fr 130px 110px minmax(280px, 1.7fr);
        gap: 0.8rem;
        align-items: start;
        padding: 0.72rem 0.9rem;
        border-bottom: 1px solid var(--line);
        font-size: 0.88rem;
      }

      .rule-row:last-child {
        border-bottom: 0;
      }

      .rule-row:hover:not(.table-head) {
        background: #f8fafc;
      }

      .table-head {
        background: #f8fafc;
        color: var(--muted);
        font-size: 0.72rem;
        font-weight: 850;
        text-transform: uppercase;
      }

      .rule-row strong,
      .rule-row span,
      .rule-row small {
        display: block;
      }

      .rule-row strong {
        font-size: 0.95rem;
      }

      .rule-row small {
        margin-top: 0.18rem;
        color: var(--muted);
      }

      .logic-cell {
        color: #344154;
        line-height: 1.35;
      }

      @media (max-width: 1100px) {
        .rules-table {
          overflow-x: auto;
        }

        .rule-row {
          min-width: 920px;
        }
      }
    `
  ]
})
export class RuleCatalogComponent implements OnInit {
  private readonly api = inject(ApiService);
  rules: RuleDefinition[] = [];
  filter = '';
  loading = true;
  busy = false;
  error = '';
  message = '';

  get filteredRules(): RuleDefinition[] {
    const needle = this.filter.toLowerCase().trim();
    if (!needle) return this.rules;
    return this.rules.filter((rule) => JSON.stringify(rule).toLowerCase().includes(needle));
  }

  get executableCount(): number {
    return this.rules.flatMap((rule) => rule.variants).filter((variant) => variant.enabled && variant.isExecutable && variant.status === 'approved').length;
  }

  get manualCount(): number {
    return this.rules.flatMap((rule) => rule.variants).filter((variant) => !variant.isExecutable).length;
  }

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      const result = await this.api.seedRules(false);
      this.rules = result.rules;
      this.message = result.seeded ? `Loaded ${result.rules.length} DAF-derived rules into the database.` : '';
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.loading = false;
    }
  }

  async syncRules(): Promise<void> {
    this.busy = true;
    this.message = '';
    this.error = '';
    try {
      const result = await this.api.seedRules(true);
      this.rules = result.rules;
      this.message = `Synced ${result.rules.length} DAF-derived rules into the database.`;
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.busy = false;
      this.loading = false;
    }
  }

  executableFor(rule: RuleDefinition): number {
    return rule.variants.filter((variant) => variant.enabled && variant.isExecutable && variant.status === 'approved').length;
  }

  firstDescription(rule: RuleDefinition): string {
    return rule.variants[0]?.description || rule.name;
  }

  private errorMessage(error: unknown): string {
    if (typeof error === 'object' && error && 'error' in error) {
      const wrapped = error as { error?: { error?: string; message?: string } };
      return wrapped.error?.error || wrapped.error?.message || 'Rule catalog failed.';
    }
    return error instanceof Error ? error.message : 'Rule catalog failed.';
  }
}
