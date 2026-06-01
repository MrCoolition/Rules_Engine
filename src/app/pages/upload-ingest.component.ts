import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../services/api.service';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="page-title">
      <div>
        <p>Upload & Ingest</p>
        <h1>Source intake</h1>
      </div>
      <button class="button ghost" (click)="ingestStandard()" [disabled]="busy || !defaultSourceAvailable">Use Standard File</button>
    </section>

    <section class="split">
      <article class="panel card-pad">
        <h2>DAF Logic Matrix</h2>
        <p class="subtle">Import DAF into the database first. Duplicate rule IDs become governed runtime variants.</p>
        <div class="toolbar">
          <button class="button secondary" (click)="bootstrap()" [disabled]="busy">Bootstrap DB</button>
          <button class="button" (click)="importDefaultDaf()" [disabled]="busy || !defaultDafAvailable">Import Workspace DAF</button>
          <label class="file-button">
            Upload DAF
            <input type="file" accept=".xlsx" (change)="onDafFile($event)">
          </label>
        </div>
      </article>

      <article class="panel card-pad">
        <h2>PRF/SORF/SRF Workbook</h2>
        <p class="subtle">Upload a workbook and the API will normalize source columns, create engine fields, and persist the batch.</p>
        <div class="form-grid">
          <label class="field">
            <span>Batch name</span>
            <input [(ngModel)]="batchName" placeholder="Daily file">
          </label>
          <label class="field">
            <span>Reporting date</span>
            <input type="date" [(ngModel)]="reportingDate">
          </label>
        </div>
        <label class="drop">
          <input type="file" accept=".xlsx" (change)="onSourceFile($event)">
          <strong>{{ sourceFile?.name || 'Choose workbook' }}</strong>
          <span>.xlsx up to daily operational size</span>
        </label>
        <button class="button" (click)="uploadSource()" [disabled]="busy || !sourceFile">Upload Workbook</button>
      </article>
    </section>

    <section class="panel run-card">
      <div>
        <h2>Run Test</h2>
        <p class="subtle">After importing DAF and uploading the standard workbook, run approved rules against the latest batch.</p>
      </div>
      <button class="button" (click)="runLatest()" [disabled]="busy || !latestBatchId">Run Latest Batch</button>
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
        font-size: 2.2rem;
      }

      .card-pad {
        padding: 1rem;
      }

      h2 {
        margin: 0;
      }

      .subtle {
        color: var(--muted);
        line-height: 1.45;
      }

      .file-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 2.35rem;
        padding: 0.55rem 0.85rem;
        border-radius: 7px;
        border: 1px solid rgba(37, 99, 235, 0.3);
        color: var(--primary);
        font-weight: 800;
        cursor: pointer;
      }

      .file-button input,
      .drop input {
        display: none;
      }

      .form-grid {
        display: grid;
        grid-template-columns: 1fr 180px;
        gap: 0.8rem;
        margin: 1rem 0;
      }

      .drop {
        display: grid;
        place-items: center;
        min-height: 9rem;
        margin-bottom: 1rem;
        border: 1px dashed rgba(37, 99, 235, 0.35);
        border-radius: var(--radius);
        background: #f8fbff;
        color: var(--muted);
        text-align: center;
        cursor: pointer;
      }

      .drop strong {
        color: var(--ink);
        max-width: 100%;
        overflow-wrap: anywhere;
      }

      .output {
        margin-top: 1rem;
        padding: 1rem;
        white-space: pre-wrap;
        overflow-x: auto;
      }

      .run-card {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 1rem;
        margin-top: 1rem;
        padding: 1rem;
      }

      .run-card h2 {
        margin: 0;
      }

      @media (max-width: 720px) {
        .page-title,
        .form-grid,
        .run-card {
          grid-template-columns: 1fr;
          flex-direction: column;
          align-items: stretch;
        }
      }
    `
  ]
})
export class UploadIngestComponent implements OnInit {
  private readonly api = inject(ApiService);
  busy = false;
  message = '';
  sourceFile: File | null = null;
  reportingDate = new Date().toISOString().slice(0, 10);
  batchName = 'Daily PRF/SORF/SRF';
  defaultDafAvailable = false;
  defaultSourceAvailable = false;
  latestBatchId = '';

  ngOnInit(): void {
    void this.api.health().then((health) => {
      this.defaultDafAvailable = health.defaultDafWorkbook;
      this.defaultSourceAvailable = health.defaultSourceWorkbook;
    });
    void this.refreshLatestBatch();
  }

  onSourceFile(event: Event): void {
    this.sourceFile = (event.target as HTMLInputElement).files?.[0] ?? null;
  }

  async onDafFile(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.busy = true;
    try {
      const result = await this.api.importDaf(file);
      this.message = JSON.stringify(result.report, null, 2);
    } finally {
      this.busy = false;
    }
  }

  async importDefaultDaf(): Promise<void> {
    this.busy = true;
    try {
      const result = await this.api.importDefaultDaf();
      this.message = JSON.stringify(result.report, null, 2);
    } finally {
      this.busy = false;
    }
  }

  async bootstrap(): Promise<void> {
    this.busy = true;
    try {
      const result = await this.api.bootstrap();
      this.message = JSON.stringify(result, null, 2);
    } finally {
      this.busy = false;
    }
  }

  async ingestStandard(): Promise<void> {
    this.busy = true;
    try {
      const result = await this.api.ingestSample(this.batchName);
      this.latestBatchId = result.batchId;
      this.message = JSON.stringify(result, null, 2);
    } finally {
      this.busy = false;
    }
  }

  async uploadSource(): Promise<void> {
    if (!this.sourceFile) return;
    this.busy = true;
    try {
      const result = await this.api.uploadWorkbook(this.sourceFile, this.reportingDate, this.batchName);
      this.latestBatchId = result.batchId;
      this.message = JSON.stringify(result, null, 2);
    } finally {
      this.busy = false;
    }
  }

  async runLatest(): Promise<void> {
    if (!this.latestBatchId) return;
    this.busy = true;
    try {
      const result = await this.api.runBatch(this.latestBatchId, false);
      this.message = JSON.stringify(result.run, null, 2);
    } finally {
      this.busy = false;
    }
  }

  private async refreshLatestBatch(): Promise<void> {
    const batches = await this.api.listBatches();
    this.latestBatchId = batches[0]?.id ?? '';
  }
}
