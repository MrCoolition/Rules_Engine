import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../services/api.service';
import type { BatchSummary, HealthResponse, RuleDefinition, RuleRun } from '../models';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <section class="page-title">
      <div>
        <p>Compliance Rules</p>
        <h1>Process PRF/SORF/SRF workbook</h1>
      </div>
      <div class="status-strip">
        <span [class]="health?.databaseConfigured ? 'tag good' : 'tag bad'">{{ health?.databaseConfigured ? 'Neon ready' : 'No database' }}</span>
        <span [class]="rulesReady ? 'tag good' : 'tag bad'">{{ rules.length }} rules</span>
        <span class="tag info">{{ executableVariantCount }} executable variants</span>
      </div>
    </section>

    <section class="panel process-card">
      <div class="process-copy">
        <h2>Upload PRF file</h2>
        <p class="subtle">Rules are already loaded from Neon. Upload the daily workbook, run the rules, then review the bucketed outcomes.</p>
      </div>

      <div class="form-grid">
        <label class="field">
          <span>Batch name</span>
          <input [(ngModel)]="batchName" placeholder="Daily PRF/SORF/SRF">
        </label>
        <label class="field">
          <span>Reporting date</span>
          <input type="date" [(ngModel)]="reportingDate">
        </label>
      </div>

      <label class="drop">
        <input type="file" accept=".xlsx" (change)="onSourceFile($event)">
        <strong>{{ sourceFile?.name || 'Choose PRF/SORF/SRF workbook' }}</strong>
        <span>Excel workbook, processed against DB rules</span>
      </label>

      <div class="actions">
        <button class="button" (click)="processWorkbook()" [disabled]="busy || !sourceFile || !rulesReady || !health?.databaseConfigured">
          {{ busy ? busyLabel : 'Process Workbook' }}
        </button>
        @if (latestBatchId) {
          <a class="button secondary" routerLink="/workbench" [queryParams]="{ batchId: latestBatchId }">Review Rows</a>
          <button class="button ghost" (click)="export('xlsx')">Export XLSX</button>
        }
      </div>

      @if (!health?.databaseConfigured) {
        <div class="alert bad">Neon is not connected in this deployment. Add DATABASE_URL, redeploy, then process a workbook.</div>
      } @else if (!rulesReady) {
        <div class="alert bad">No executable rules are available in Neon. The rules table needs to be seeded before processing.</div>
      } @else {
        <div class="alert good">Ready. Upload the standard workbook and click Process Workbook.</div>
      }
    </section>

    @if (run) {
      <section class="kpi-grid result-kpis">
        <article class="panel kpi"><small>Input Rows</small><strong>{{ run.inputRowCount }}</strong></article>
        <article class="panel kpi"><small>Changed Rows</small><strong>{{ run.changedRowCount }}</strong></article>
        <article class="panel kpi"><small>Review Rows</small><strong>{{ run.reviewRowCount }}</strong></article>
        <article class="panel kpi"><small>Status</small><strong>{{ run.status }}</strong></article>
      </section>
    }

    @if (summary) {
      <section class="split result-row">
        <article class="panel bucket-card">
          <h2>Result Buckets</h2>
          @for (entry of entries(summary.outcomeCounts); track entry[0]) {
            <div class="bar-line">
              <span>{{ entry[0] }}</span>
              <div class="bar"><i [style.width.%]="percent(entry[1], summary.rowCount)"></i></div>
              <strong>{{ entry[1] }}</strong>
            </div>
          }
        </article>
        <article class="panel bucket-card">
          <h2>Request Mix</h2>
          @for (entry of entries(summary.typeCounts); track entry[0]) {
            <div class="bar-line teal">
              <span>{{ entry[0] }}</span>
              <div class="bar"><i [style.width.%]="percent(entry[1], summary.rowCount)"></i></div>
              <strong>{{ entry[1] }}</strong>
            </div>
          }
        </article>
      </section>
    }

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
        gap: 1rem;
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
        font-size: clamp(2rem, 4vw, 3rem);
      }

      .status-strip,
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.55rem;
        align-items: center;
      }

      .process-card,
      .bucket-card {
        padding: 1rem;
      }

      .process-copy h2,
      .bucket-card h2 {
        margin: 0;
      }

      .subtle {
        color: var(--muted);
        line-height: 1.45;
      }

      .form-grid {
        display: grid;
        grid-template-columns: minmax(220px, 1fr) 190px;
        gap: 0.8rem;
        margin: 1rem 0;
      }

      .drop {
        display: grid;
        place-items: center;
        min-height: 10rem;
        margin-bottom: 1rem;
        border: 1px dashed rgba(37, 99, 235, 0.35);
        border-radius: var(--radius);
        background: #f8fbff;
        color: var(--muted);
        text-align: center;
        cursor: pointer;
      }

      .drop input {
        display: none;
      }

      .drop strong {
        color: var(--ink);
        max-width: 100%;
        overflow-wrap: anywhere;
      }

      .alert {
        margin-top: 1rem;
        padding: 0.8rem 0.9rem;
        border-radius: 7px;
        font-weight: 750;
      }

      .alert.good {
        background: #dcfce7;
        color: #166534;
      }

      .alert.bad {
        background: #fee2e2;
        color: #991b1b;
      }

      .result-kpis,
      .result-row,
      .output {
        margin-top: 1rem;
      }

      .bar-line {
        display: grid;
        grid-template-columns: 150px minmax(0, 1fr) 52px;
        align-items: center;
        gap: 0.7rem;
        margin: 0.75rem 0;
      }

      .bar-line span {
        color: var(--muted);
        font-weight: 750;
        overflow-wrap: anywhere;
      }

      .bar {
        height: 0.72rem;
        border-radius: 6px;
        background: #e2e8f0;
        overflow: hidden;
      }

      .bar i {
        display: block;
        height: 100%;
        min-width: 2px;
        background: var(--primary);
      }

      .bar-line.teal .bar i {
        background: var(--teal);
      }

      .output {
        padding: 1rem;
        white-space: pre-wrap;
        overflow-x: auto;
      }

      @media (max-width: 760px) {
        .page-title {
          align-items: stretch;
          flex-direction: column;
        }

        .form-grid {
          grid-template-columns: 1fr;
        }
      }
    `
  ]
})
export class UploadIngestComponent implements OnInit {
  private readonly api = inject(ApiService);
  health: HealthResponse | null = null;
  rules: RuleDefinition[] = [];
  busy = false;
  busyLabel = '';
  message = '';
  sourceFile: File | null = null;
  reportingDate = new Date().toISOString().slice(0, 10);
  batchName = 'Daily PRF/SORF/SRF';
  latestBatchId = '';
  run: RuleRun | null = null;
  summary: BatchSummary | null = null;

  get executableVariantCount(): number {
    return this.rules.flatMap((rule) => rule.variants).filter((variant) => variant.enabled && variant.isExecutable).length;
  }

  get rulesReady(): boolean {
    return this.rules.length > 0 && this.executableVariantCount > 0;
  }

  ngOnInit(): void {
    void this.refreshReadiness();
  }

  onSourceFile(event: Event): void {
    this.sourceFile = (event.target as HTMLInputElement).files?.[0] ?? null;
    this.run = null;
    this.summary = null;
    this.message = '';
  }

  async processWorkbook(): Promise<void> {
    if (!this.sourceFile || !this.rulesReady || !this.health?.databaseConfigured) return;
    this.busy = true;
    try {
      this.busyLabel = 'Uploading...';
      const upload = await this.api.uploadWorkbook(this.sourceFile, this.reportingDate, this.batchName);
      this.latestBatchId = upload.batchId;

      this.busyLabel = 'Running rules...';
      const result = await this.api.runBatch(upload.batchId, false);
      this.run = result.run;

      this.busyLabel = 'Loading buckets...';
      this.summary = await this.api.batchSummary(upload.batchId);
      this.message = upload.warnings.length ? upload.warnings.join('\n') : '';
    } catch (error) {
      this.message = this.errorMessage(error);
    } finally {
      this.busy = false;
      this.busyLabel = '';
    }
  }

  export(format: 'csv' | 'xlsx'): void {
    if (this.latestBatchId) this.api.exportBatch(this.latestBatchId, format);
  }

  entries(record: Record<string, number>): [string, number][] {
    return Object.entries(record).sort((a, b) => b[1] - a[1]);
  }

  percent(value: number, total: number): number {
    return total ? Math.max((value / total) * 100, 2) : 0;
  }

  private async refreshReadiness(): Promise<void> {
    [this.health, this.rules] = await Promise.all([this.api.health(), this.api.listRules()]);
  }

  private errorMessage(error: unknown): string {
    if (typeof error === 'object' && error && 'error' in error) {
      const wrapped = error as { error?: { error?: string; message?: string } };
      return wrapped.error?.error || wrapped.error?.message || 'Processing failed.';
    }
    return error instanceof Error ? error.message : 'Processing failed.';
  }
}
