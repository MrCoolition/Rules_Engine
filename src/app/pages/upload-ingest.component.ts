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
        <p>Process</p>
        <h1>Run PRF workbook</h1>
        <p class="page-copy">Upload the standard PRF/SORF/SRF file. The engine uses DAF-derived rules seeded in Neon and returns bucketed outcomes.</p>
      </div>
      <div class="status-strip">
        @if (loadingReadiness) {
          <span class="tag info">Checking</span>
        } @else {
          <span [class]="dbReady ? 'tag good' : 'tag bad'">{{ dbReady ? 'Neon connected' : 'No database' }}</span>
          <span [class]="rulesReady ? 'tag good' : 'tag bad'">{{ rules.length }} rules</span>
          <span [class]="executableVariantCount ? 'tag good' : 'tag bad'">{{ executableVariantCount }} executable</span>
        }
      </div>
    </section>

    <section class="panel workflow-panel">
      <div class="workflow-grid">
        <div class="workbook-pane">
          <h2>Workbook</h2>
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
            <strong>{{ sourceFile?.name || 'Choose workbook' }}</strong>
            <span>.xlsx PRF/SORF/SRF source file</span>
          </label>

          <div class="actions">
            <button class="button" (click)="processWorkbook()" [disabled]="busy || loadingReadiness || !sourceFile || !rulesReady || !dbReady">
              {{ busy ? busyLabel : 'Process Workbook' }}
            </button>
            @if (latestBatchId) {
              <a class="button secondary" routerLink="/workbench" [queryParams]="{ batchId: latestBatchId }">Review Rows</a>
              <button class="button ghost" (click)="export('xlsx')">Export XLSX</button>
            }
          </div>
        </div>

        <aside class="engine-pane">
          <h2>Engine</h2>
          <div class="engine-row">
            <span>Database</span>
            <strong>{{ loadingReadiness ? 'Checking' : dbReady ? 'Neon' : 'Missing' }}</strong>
          </div>
          <div class="engine-row">
            <span>Rule catalog</span>
            <strong>{{ loadingReadiness ? 'Checking' : rulesReady ? 'Ready' : 'Empty' }}</strong>
          </div>
          <div class="engine-row">
            <span>Rule source</span>
            <strong>DAF seed</strong>
          </div>

          @if (loadingReadiness) {
            <div class="alert info">Checking Neon and seeded rules.</div>
          } @else if (readinessError) {
            <div class="alert bad">{{ readinessError }}</div>
          } @else if (!dbReady) {
            <div class="alert bad">DATABASE_URL is not visible to this deployment.</div>
          } @else if (!rulesReady) {
            <div class="alert bad">No executable rules are available. Open Rules and sync the DB catalog.</div>
          } @else {
            <div class="alert good">Ready to process against {{ executableVariantCount }} executable rules.</div>
          }
        </aside>
      </div>
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
            <div class="bar-line accent">
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
      .status-strip {
        display: flex;
        flex-wrap: wrap;
        gap: 0.45rem;
        justify-content: flex-end;
      }

      .workflow-panel {
        padding: 1rem;
      }

      .workflow-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 280px;
        gap: 1rem;
      }

      .workbook-pane h2,
      .engine-pane h2,
      .bucket-card h2 {
        margin: 0 0 0.85rem;
        font-size: 1rem;
      }

      .form-grid {
        display: grid;
        grid-template-columns: minmax(220px, 1fr) 180px;
        gap: 0.75rem;
      }

      .drop {
        display: grid;
        place-items: center;
        gap: 0.25rem;
        min-height: 7rem;
        margin: 0.85rem 0;
        border: 1px dashed #aeb9c8;
        border-radius: var(--radius);
        background: #f8fafc;
        color: var(--muted);
        text-align: center;
        cursor: pointer;
      }

      .drop:hover {
        border-color: var(--accent);
        background: #f6fffd;
      }

      .drop input {
        display: none;
      }

      .drop strong {
        color: var(--ink);
        max-width: 100%;
        overflow-wrap: anywhere;
      }

      .drop span {
        font-size: 0.86rem;
      }

      .engine-pane {
        display: grid;
        align-content: start;
        gap: 0.7rem;
        padding-left: 1rem;
        border-left: 1px solid var(--line);
      }

      .engine-row {
        display: flex;
        justify-content: space-between;
        gap: 1rem;
        padding-bottom: 0.58rem;
        border-bottom: 1px solid var(--line);
        font-size: 0.9rem;
      }

      .engine-row span {
        color: var(--muted);
      }

      .engine-row strong {
        text-align: right;
      }

      .result-kpis,
      .result-row,
      .output {
        margin-top: 0.9rem;
      }

      .bucket-card {
        padding: 1rem;
      }

      .bar-line {
        display: grid;
        grid-template-columns: 150px minmax(0, 1fr) 48px;
        align-items: center;
        gap: 0.65rem;
        margin: 0.65rem 0;
      }

      .bar-line span {
        color: var(--muted);
        font-weight: 720;
        overflow-wrap: anywhere;
      }

      .bar {
        height: 0.56rem;
        border-radius: 999px;
        background: #e5eaf0;
        overflow: hidden;
      }

      .bar i {
        display: block;
        height: 100%;
        min-width: 2px;
        background: var(--primary);
      }

      .bar-line.accent .bar i {
        background: var(--accent);
      }

      .output {
        padding: 0.85rem;
        white-space: pre-wrap;
        overflow-x: auto;
      }

      @media (max-width: 900px) {
        .workflow-grid,
        .form-grid {
          grid-template-columns: 1fr;
        }

        .engine-pane {
          padding-left: 0;
          border-left: 0;
          border-top: 1px solid var(--line);
          padding-top: 1rem;
        }
      }
    `
  ]
})
export class UploadIngestComponent implements OnInit {
  private readonly api = inject(ApiService);
  health: HealthResponse | null = null;
  rules: RuleDefinition[] = [];
  loadingReadiness = true;
  readinessError = '';
  busy = false;
  busyLabel = '';
  message = '';
  sourceFile: File | null = null;
  reportingDate = new Date().toISOString().slice(0, 10);
  batchName = 'Daily PRF/SORF/SRF';
  latestBatchId = '';
  run: RuleRun | null = null;
  summary: BatchSummary | null = null;

  get dbReady(): boolean {
    return this.health?.databaseConfigured === true;
  }

  get executableVariantCount(): number {
    return this.rules.flatMap((rule) => rule.variants).filter((variant) => variant.enabled && variant.isExecutable && variant.status === 'approved').length;
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
    if (!this.sourceFile || !this.rulesReady || !this.dbReady) return;
    this.busy = true;
    try {
      this.busyLabel = 'Uploading';
      const upload = await this.api.uploadWorkbook(this.sourceFile, this.reportingDate, this.batchName);
      this.latestBatchId = upload.batchId;

      this.busyLabel = 'Running rules';
      const result = await this.api.runBatch(upload.batchId, false);
      this.run = result.run;

      this.busyLabel = 'Loading buckets';
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
    this.loadingReadiness = true;
    this.readinessError = '';
    try {
      this.health = await this.api.health();
      this.rules = await this.api.listRules();
    } catch (error) {
      this.readinessError = this.errorMessage(error);
    } finally {
      this.loadingReadiness = false;
    }
  }

  private errorMessage(error: unknown): string {
    if (typeof error === 'object' && error && 'error' in error) {
      const wrapped = error as { error?: { error?: string; message?: string } };
      return wrapped.error?.error || wrapped.error?.message || 'Processing failed.';
    }
    return error instanceof Error ? error.message : 'Processing failed.';
  }
}
