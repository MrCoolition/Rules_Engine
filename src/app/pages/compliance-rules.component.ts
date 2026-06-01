import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ApiService } from '../services/api.service';
import type { HealthResponse, RuleDefinition, SourceBatch } from '../models';

@Component({
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <section class="page-head">
      <div>
        <p class="eyebrow">Compliance Rules</p>
        <h1>PRF/SORF/SRF engine</h1>
        <p class="page-copy">Upload the standard file, execute the DAF-derived DB rules, then review bucketed outcomes.</p>
      </div>
      <div class="toolbar">
        <a class="button" routerLink="/upload">Process Workbook</a>
      </div>
    </section>

    @if (error) {
      <div class="alert bad notice">{{ error }}</div>
    } @else if (loading) {
      <div class="alert info notice">Checking Neon and rule readiness.</div>
    }

    <section class="kpi-grid">
      <article class="panel kpi">
        <small>Database</small>
        <strong>{{ loading ? 'Checking' : health?.databaseConfigured ? 'Neon' : 'Missing' }}</strong>
      </article>
      <article class="panel kpi">
        <small>Batches</small>
        <strong>{{ batches.length }}</strong>
      </article>
      <article class="panel kpi">
        <small>Rules</small>
        <strong>{{ loading ? 'Checking' : rules.length }}</strong>
      </article>
      <article class="panel kpi">
        <small>Executable</small>
        <strong>{{ loading ? 'Checking' : executableVariantCount }}</strong>
      </article>
    </section>

    <section class="split content-row">
      <article class="panel card-pad">
        <div class="section-title">
          <h2>Recent Batches</h2>
          <a routerLink="/upload">Process</a>
        </div>

        @if (!batches.length) {
          <div class="empty">No batches yet. Process a PRF/SORF/SRF workbook to start.</div>
        } @else {
          <div class="table-scroll">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Rows</th>
                  <th>Status</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                @for (batch of batches.slice(0, 6); track batch.id) {
                  <tr>
                    <td><a [routerLink]="['/workbench']" [queryParams]="{ batchId: batch.id }">{{ batch.name }}</a></td>
                    <td>{{ batch.rowCount }}</td>
                    <td><span class="tag info">{{ batch.status }}</span></td>
                    <td>{{ batch.sourceFileName }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </article>

      <article class="panel card-pad">
        <div class="section-title">
          <h2>Readiness</h2>
          <a routerLink="/rules">Rules</a>
        </div>
        <div class="readiness">
          <div>
            <span [class]="health?.databaseConfigured ? 'tag good' : 'tag bad'">{{ health?.databaseConfigured ? 'Neon connected' : 'No database' }}</span>
            <p>DATABASE_URL must be available in Vercel for persisted batches and rule execution.</p>
          </div>
          <div>
            <span [class]="loading ? 'tag info' : rules.length ? 'tag good' : 'tag bad'">{{ loading ? 'Checking rules' : 'DAF rules seeded' }}</span>
            <p>{{ loading ? 'Loading DB-backed rules.' : rules.length + ' rule definitions are loaded from the DB catalog.' }}</p>
          </div>
          <div>
            <span [class]="loading ? 'tag info' : executableVariantCount ? 'tag good' : 'tag bad'">Executable variants</span>
            <p>{{ loading ? 'Checking executable variants.' : executableVariantCount + ' approved variants can run against PRF rows.' }}</p>
          </div>
        </div>
      </article>
    </section>
  `,
  styles: [
    `
      .content-row,
      .notice {
        margin-top: 0.9rem;
      }

      .card-pad {
        padding: 1rem;
      }

      .section-title {
        display: flex;
        justify-content: space-between;
        gap: 1rem;
        align-items: center;
        margin-bottom: 0.75rem;
      }

      .section-title h2 {
        margin: 0;
        font-size: 1rem;
      }

      .section-title a {
        color: var(--accent-2);
        font-weight: 780;
      }

      .readiness {
        display: grid;
        gap: 0.8rem;
      }

      .readiness p {
        margin: 0.38rem 0 0;
        color: var(--muted);
        line-height: 1.45;
      }
    `
  ]
})
export class ComplianceRulesComponent implements OnInit {
  private readonly api = inject(ApiService);
  health: HealthResponse | null = null;
  batches: SourceBatch[] = [];
  rules: RuleDefinition[] = [];
  loading = true;
  error = '';

  get executableVariantCount(): number {
    return this.rules.flatMap((rule) => rule.variants).filter((variant) => variant.enabled && variant.isExecutable && variant.status === 'approved').length;
  }

  ngOnInit(): void {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      this.health = await this.api.health();
      const [batches, seeded] = await Promise.all([this.api.listBatches(), this.api.seedRules(false)]);
      this.batches = batches;
      this.rules = seeded.rules;
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.loading = false;
    }
  }

  private errorMessage(error: unknown): string {
    if (typeof error === 'object' && error && 'error' in error) {
      const wrapped = error as { error?: { error?: string; message?: string } };
      return wrapped.error?.error || wrapped.error?.message || 'Readiness check failed.';
    }
    return error instanceof Error ? error.message : 'Readiness check failed.';
  }
}
