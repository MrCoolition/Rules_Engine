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
        <p>Rule Catalog</p>
        <h1>Database-backed compliance rules</h1>
      </div>
    </section>

    <section class="panel catalog-tools">
      <label class="field">
        <span>Filter</span>
        <input [(ngModel)]="filter" placeholder="R001, Canada, approval, manual">
      </label>
      <div class="rule-totals">
        <span class="tag info">{{ rules.length }} definitions</span>
        <span class="tag good">{{ executableCount }} executable</span>
        <span class="tag warn">{{ manualCount }} guided/manual</span>
      </div>
    </section>

    <section class="rules-list">
      @for (rule of filteredRules; track rule.ruleId) {
        <article class="panel rule-card">
          <header>
            <div>
              <strong>{{ rule.ruleId }}</strong>
              <h2>{{ rule.ruleGroup }}</h2>
            </div>
            <span [class]="rule.automationLevel === 'alpha' ? 'tag good' : 'tag warn'">{{ rule.automationLevel }}</span>
          </header>
          <p>{{ rule.businessScope }} · {{ rule.requestTypes.join(', ') || 'All' }}</p>
          <div class="variants">
            @for (variant of rule.variants; track variant.runtimeRuleId) {
              <div>
                <span>{{ variant.runtimeRuleId }}</span>
                <b [class]="variant.isExecutable ? 'tag good' : 'tag warn'">{{ variant.isExecutable ? 'executable' : 'guided' }}</b>
                <small>{{ variant.description }}</small>
              </div>
            }
          </div>
        </article>
      } @empty {
        <div class="empty">No rules imported yet.</div>
      }
    </section>

    @if (message) {
      <pre class="panel output">{{ message }}</pre>
    }
  `,
  styles: [
    `
      .page-title {
        display: flex;
        justify-content: space-between;
        align-items: end;
        margin-bottom: 1rem;
      }

      .page-title p {
        margin: 0 0 0.25rem;
        color: var(--teal);
        font-weight: 900;
        text-transform: uppercase;
      }

      .page-title h1 {
        margin: 0;
      }

      .catalog-tools {
        display: flex;
        flex-wrap: wrap;
        align-items: end;
        justify-content: space-between;
        gap: 1rem;
        padding: 1rem;
      }

      .catalog-tools .field {
        flex: 1 1 320px;
      }

      .rule-totals {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
      }

      .rules-list {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 1rem;
        margin-top: 1rem;
      }

      .rule-card {
        padding: 1rem;
      }

      .rule-card header {
        display: flex;
        justify-content: space-between;
        gap: 1rem;
      }

      .rule-card strong {
        color: var(--primary);
      }

      .rule-card h2 {
        margin: 0.2rem 0 0;
        font-size: 1rem;
      }

      .rule-card p {
        color: var(--muted);
      }

      .variants {
        display: grid;
        gap: 0.55rem;
      }

      .variants div {
        display: grid;
        gap: 0.35rem;
        padding: 0.6rem;
        border-radius: 7px;
        background: #f8fafc;
      }

      .variants small {
        color: var(--muted);
        line-height: 1.35;
      }

      .output {
        margin-top: 1rem;
        padding: 1rem;
        overflow-x: auto;
      }

      @media (max-width: 980px) {
        .rules-list {
          grid-template-columns: 1fr;
        }
      }
    `
  ]
})
export class RuleCatalogComponent implements OnInit {
  private readonly api = inject(ApiService);
  rules: RuleDefinition[] = [];
  filter = '';
  message = '';

  get filteredRules(): RuleDefinition[] {
    const needle = this.filter.toLowerCase().trim();
    if (!needle) return this.rules;
    return this.rules.filter((rule) => JSON.stringify(rule).toLowerCase().includes(needle));
  }

  get executableCount(): number {
    return this.rules.flatMap((rule) => rule.variants).filter((variant) => variant.isExecutable).length;
  }

  get manualCount(): number {
    return this.rules.flatMap((rule) => rule.variants).filter((variant) => !variant.isExecutable).length;
  }

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.rules = await this.api.listRules();
  }

}
