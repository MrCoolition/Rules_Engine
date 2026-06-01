import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../services/api.service';
import type { BatchSummary, SourceBatch } from '../models';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="page-title">
      <div>
        <p>Outcome Reporting</p>
        <h1>Decision rollups</h1>
      </div>
      <div class="toolbar">
        <button class="button secondary" (click)="export('csv')" [disabled]="!selectedBatchId">CSV</button>
        <button class="button" (click)="export('xlsx')" [disabled]="!selectedBatchId">XLSX</button>
      </div>
    </section>

    <section class="panel report-filter">
      <label class="field">
        <span>Batch</span>
        <select [(ngModel)]="selectedBatchId" (change)="loadSummary()">
          <option value="">Select batch</option>
          @for (batch of batches; track batch.id) {
            <option [value]="batch.id">{{ batch.name }}</option>
          }
        </select>
      </label>
    </section>

    @if (summary) {
      <section class="kpi-grid report-grid">
        <article class="panel kpi"><small>Rows</small><strong>{{ summary.rowCount }}</strong></article>
        <article class="panel kpi"><small>Approved</small><strong>{{ summary.approvedCount }}</strong></article>
        <article class="panel kpi"><small>Review</small><strong>{{ summary.reviewCount }}</strong></article>
        <article class="panel kpi"><small>Coverage</small><strong>{{ summary.automationCoveragePct }}%</strong></article>
      </section>

      <section class="split report-row">
        <article class="panel chart-card">
          <h2>Outcomes</h2>
          @for (entry of entries(summary.outcomeCounts); track entry[0]) {
            <div class="bar-line">
              <span>{{ entry[0] }}</span>
              <div class="bar"><i [style.width.%]="percent(entry[1], summary.rowCount)"></i></div>
              <strong>{{ entry[1] }}</strong>
            </div>
          }
        </article>
        <article class="panel chart-card">
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
    } @else {
      <div class="empty">Select a processed batch to view reporting.</div>
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

      .report-filter,
      .chart-card {
        padding: 1rem;
      }

      .report-grid,
      .report-row {
        margin-top: 1rem;
      }

      .chart-card h2 {
        margin: 0 0 0.8rem;
      }

      .bar-line {
        display: grid;
        grid-template-columns: 140px minmax(0, 1fr) 48px;
        align-items: center;
        gap: 0.7rem;
        margin: 0.7rem 0;
      }

      .bar-line span {
        color: var(--muted);
        font-weight: 750;
        overflow-wrap: anywhere;
      }

      .bar {
        height: 0.7rem;
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
    `
  ]
})
export class ReportsComponent implements OnInit {
  private readonly api = inject(ApiService);
  batches: SourceBatch[] = [];
  selectedBatchId = '';
  summary: BatchSummary | null = null;

  ngOnInit(): void {
    void this.init();
  }

  async init(): Promise<void> {
    this.batches = await this.api.listBatches();
    this.selectedBatchId = this.batches[0]?.id ?? '';
    await this.loadSummary();
  }

  async loadSummary(): Promise<void> {
    this.summary = this.selectedBatchId ? await this.api.batchSummary(this.selectedBatchId) : null;
  }

  export(format: 'csv' | 'xlsx'): void {
    if (this.selectedBatchId) this.api.exportBatch(this.selectedBatchId, format);
  }

  entries(record: Record<string, number>): [string, number][] {
    return Object.entries(record).sort((a, b) => b[1] - a[1]);
  }

  percent(value: number, total: number): number {
    return total ? Math.max((value / total) * 100, 2) : 0;
  }
}
