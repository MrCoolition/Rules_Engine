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
        <p class="eyebrow">Analyst command center</p>
        <h1>Daily rules execution</h1>
      </div>
      <div class="toolbar">
        <button class="button ghost" (click)="importDaf()" [disabled]="busy || !health?.defaultDafWorkbook">{{ busyLabel || 'Import DAF' }}</button>
        <button class="button" (click)="ingestSample()" [disabled]="busy || !health?.defaultSourceWorkbook">Ingest Standard File</button>
      </div>
    </section>

    @if (message) {
      <div class="notice">{{ message }}</div>
    }

    <section class="kpi-grid">
      <article class="panel kpi">
        <small>Storage</small>
        <strong>{{ health?.store || 'checking' }}</strong>
      </article>
      <article class="panel kpi">
        <small>Batches</small>
        <strong>{{ batches.length }}</strong>
      </article>
      <article class="panel kpi">
        <small>Rules</small>
        <strong>{{ rules.length }}</strong>
      </article>
      <article class="panel kpi">
        <small>Executable Variants</small>
        <strong>{{ executableVariantCount }}</strong>
      </article>
    </section>

    <section class="split content-row">
      <article class="panel card-pad">
        <div class="section-title">
          <h2>Latest Batches</h2>
          <a routerLink="/upload">Upload</a>
        </div>

        @if (!batches.length) {
          <div class="empty">No batches yet. Ingest the standard file to create the first workflow.</div>
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
          <h2>Run Readiness</h2>
          <a routerLink="/settings">Health</a>
        </div>
        <div class="readiness">
          <div>
            <span [class]="health?.databaseConfigured ? 'tag good' : 'tag warn'">{{ health?.databaseConfigured ? 'Neon connected' : 'Demo memory' }}</span>
            <p>Neon is used when <code>DATABASE_URL</code> is present. Otherwise, the API stays usable in local memory mode.</p>
          </div>
          <div>
            <span [class]="health?.defaultDafWorkbook ? 'tag good' : 'tag bad'">DAF workbook</span>
            <p>Default catalog import uses the local workbook. On Vercel, upload DAF from the intake screen.</p>
          </div>
          <div>
            <span [class]="health?.defaultSourceWorkbook ? 'tag good' : 'tag bad'">Standard file</span>
            <p>Standard PRF/SORF/SRF ingestion uses the local workbook. On Vercel, upload the daily workbook.</p>
          </div>
        </div>
      </article>
    </section>
  `,
  styles: [
    `
      .page-head {
        display: flex;
        justify-content: space-between;
        align-items: end;
        gap: 1rem;
        margin-bottom: 1rem;
      }

      .eyebrow {
        margin: 0 0 0.25rem;
        color: var(--teal);
        font-weight: 900;
        text-transform: uppercase;
        font-size: 0.78rem;
      }

      h1 {
        margin: 0;
        font-size: clamp(2rem, 5vw, 3.4rem);
        letter-spacing: 0;
      }

      .content-row {
        margin-top: 1rem;
      }

      .card-pad {
        padding: 1rem;
      }

      .section-title {
        display: flex;
        justify-content: space-between;
        gap: 1rem;
        align-items: center;
        margin-bottom: 0.8rem;
      }

      .section-title h2 {
        margin: 0;
        font-size: 1rem;
      }

      .section-title a {
        color: var(--primary);
        font-weight: 800;
      }

      .readiness {
        display: grid;
        gap: 0.85rem;
      }

      .readiness p {
        margin: 0.45rem 0 0;
        color: var(--muted);
        line-height: 1.45;
      }

      .notice {
        margin-bottom: 1rem;
        padding: 0.8rem 1rem;
        border-radius: var(--radius);
        background: #ecfeff;
        border: 1px solid #a5f3fc;
        color: #155e75;
        font-weight: 750;
      }

      code {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }

      @media (max-width: 760px) {
        .page-head {
          align-items: stretch;
          flex-direction: column;
        }
      }
    `
  ]
})
export class CommandCenterComponent implements OnInit {
  private readonly api = inject(ApiService);
  health: HealthResponse | null = null;
  batches: SourceBatch[] = [];
  rules: RuleDefinition[] = [];
  busy = false;
  busyLabel = '';
  message = '';

  get executableVariantCount(): number {
    return this.rules.flatMap((rule) => rule.variants).filter((variant) => variant.isExecutable).length;
  }

  ngOnInit(): void {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    [this.health, this.batches, this.rules] = await Promise.all([this.api.health(), this.api.listBatches(), this.api.listRules()]);
  }

  async importDaf(): Promise<void> {
    this.busy = true;
    this.busyLabel = 'Importing...';
    try {
      const result = await this.api.importDefaultDaf();
      this.message = `Imported ${result.rules.length} DAF rules.`;
      await this.refresh();
    } finally {
      this.busy = false;
      this.busyLabel = '';
    }
  }

  async ingestSample(): Promise<void> {
    this.busy = true;
    try {
      const result = await this.api.ingestSample();
      this.message = `Created batch ${result.batchId} with ${result.rowCount} rows.`;
      await this.refresh();
    } finally {
      this.busy = false;
    }
  }
}
