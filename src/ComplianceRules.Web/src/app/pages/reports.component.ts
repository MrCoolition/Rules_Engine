import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../services/api.service';
import type { BatchSummary, SourceBatch } from '../models';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <section class="page-title">
      <div>
        <p>Buckets</p>
        <h1>Compliance buckets</h1>
        <span>Like outputs are grouped into reviewable queues after the saved rules run.</span>
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
        <article class="panel kpi"><small>Buckets</small><strong>{{ summary.bucketSummaries.length }}</strong></article>
        <article class="panel kpi"><small>Review</small><strong>{{ summary.reviewCount }}</strong></article>
        <article class="panel kpi"><small>Coverage</small><strong>{{ summary.automationCoveragePct }}%</strong></article>
      </section>

      <section class="bucket-grid">
        @for (bucket of summary.bucketSummaries; track bucket.id) {
          <article
            class="panel bucket-card"
            [class.good]="bucket.tone === 'good'"
            [class.warn]="bucket.tone === 'warn'"
            [class.bad]="bucket.tone === 'bad'"
            [class.info]="bucket.tone === 'info'"
            [class.dark]="bucket.tone === 'dark'"
          >
            <div class="bucket-head">
              <div>
                <h2>{{ bucket.label }}</h2>
                <p>{{ bucket.description }}</p>
              </div>
              <strong>{{ bucket.count }}</strong>
            </div>

            <div class="meter"><i [style.width.%]="percent(bucket.count, summary.rowCount)"></i></div>

            <div class="bucket-meta">
              <span>{{ percent(bucket.count, summary.rowCount) | number:'1.0-0' }}% of batch</span>
              <span>{{ bucket.reviewCount }} review</span>
            </div>

            <div class="chips">
              @for (ruleId of bucket.ruleIds.slice(0, 6); track ruleId) {
                <span>{{ ruleId }}</span>
              }
              @if (!bucket.ruleIds.length) {
                <span>No trace</span>
              }
            </div>

            <div class="examples">
              @for (example of bucket.examples; track example.rowId) {
                <div>
                  <b>{{ example.caseNumber || 'No case' }}</b>
                  <span>{{ example.vendor || example.description || 'No row detail' }}</span>
                  <small>{{ example.action || 'Blank action' }} / {{ example.buysmartAction || 'Blank BuySmart' }}</small>
                </div>
              }
            </div>

            <div class="bucket-actions">
              <a class="button secondary" [routerLink]="['/workbench']" [queryParams]="{ batchId: selectedBatchId, bucket: bucket.id }">Review Bucket</a>
            </div>
          </article>
        }
      </section>

      <section class="split report-row">
        <article class="panel chart-card">
          <h2>Outcome Mix</h2>
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
        color: var(--accent);
        font-weight: 900;
        text-transform: uppercase;
      }

      .page-title span {
        display: block;
        margin-top: 0.35rem;
        color: var(--muted);
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

      .bucket-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 0.9rem;
        margin-top: 1rem;
      }

      .bucket-card {
        display: grid;
        gap: 0.8rem;
        padding: 1rem;
        border-top: 4px solid var(--primary);
      }

      .bucket-card.good {
        border-top-color: var(--good);
      }

      .bucket-card.warn {
        border-top-color: var(--warn);
      }

      .bucket-card.bad {
        border-top-color: var(--danger);
      }

      .bucket-card.info {
        border-top-color: var(--accent-2);
      }

      .bucket-card.dark {
        border-top-color: var(--primary);
      }

      .bucket-head {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 1rem;
        align-items: start;
      }

      .bucket-head h2,
      .bucket-head p {
        margin: 0;
      }

      .bucket-head h2 {
        font-size: 1rem;
      }

      .bucket-head p {
        margin-top: 0.3rem;
        color: var(--muted);
        line-height: 1.35;
      }

      .bucket-head strong {
        font-size: 2rem;
        line-height: 1;
      }

      .meter {
        height: 0.52rem;
        border-radius: 999px;
        background: #e2e8f0;
        overflow: hidden;
      }

      .meter i {
        display: block;
        height: 100%;
        min-width: 3px;
        background: var(--primary);
      }

      .bucket-card.good .meter i {
        background: var(--good);
      }

      .bucket-card.warn .meter i {
        background: var(--warn);
      }

      .bucket-card.bad .meter i {
        background: var(--danger);
      }

      .bucket-card.info .meter i {
        background: var(--accent-2);
      }

      .bucket-meta,
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
      }

      .bucket-meta span,
      .chips span {
        border-radius: 999px;
        background: #f1f5f9;
        color: var(--muted);
        font-size: 0.76rem;
        font-weight: 850;
        padding: 0.24rem 0.48rem;
      }

      .examples {
        display: grid;
        gap: 0.55rem;
        min-height: 5rem;
      }

      .examples div {
        display: grid;
        gap: 0.12rem;
        padding-top: 0.55rem;
        border-top: 1px solid var(--line);
      }

      .examples b,
      .examples span,
      .examples small {
        overflow-wrap: anywhere;
      }

      .examples span,
      .examples small {
        color: var(--muted);
      }

      .bucket-actions {
        display: flex;
        justify-content: flex-end;
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
        background: var(--accent);
      }

      @media (max-width: 1100px) {
        .bucket-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @media (max-width: 720px) {
        .page-title {
          align-items: start;
          flex-direction: column;
        }

        .bucket-grid {
          grid-template-columns: 1fr;
        }
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
