import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../services/api.service';
import type { SourceBatch, WorkflowRow } from '../models';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="page-title">
      <div>
        <p>Analyst Workbench</p>
        <h1>Review workflow rows</h1>
      </div>
      <button class="button ghost" (click)="loadRows()">Refresh Rows</button>
    </section>

    <section class="panel filters">
      <div class="toolbar">
        <label class="field">
          <span>Batch</span>
          <select [(ngModel)]="selectedBatchId" (change)="loadRows()">
            <option value="">Select batch</option>
            @for (batch of batches; track batch.id) {
              <option [value]="batch.id">{{ batch.name }}</option>
            }
          </select>
        </label>
        <label class="field search">
          <span>Search</span>
          <input [(ngModel)]="search" (keyup.enter)="loadRows()" placeholder="Case, vendor, DIN, description">
        </label>
        <label class="field">
          <span>Needs review</span>
          <select [(ngModel)]="needsReview" (change)="loadRows()">
            <option value="">All</option>
            <option value="true">Review</option>
            <option value="false">Ready</option>
          </select>
        </label>
        <button class="button" (click)="loadRows()" [disabled]="!selectedBatchId">Apply</button>
      </div>
    </section>

    <section class="split workbench">
      <article class="panel table-card">
        <div class="table-meta">{{ total }} rows</div>
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>Case</th>
                <th>Business</th>
                <th>Type</th>
                <th>Vendor</th>
                <th>Action</th>
                <th>BuySmart</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              @for (row of rows; track row.id) {
                <tr (click)="selectRow(row)" [class.selected]="selected?.id === row.id">
                  <td>{{ row.caseNumber }}</td>
                  <td>{{ row.business }}</td>
                  <td>{{ row.requestType }}</td>
                  <td>{{ row.vendor }}</td>
                  <td>{{ row.action || '-' }}</td>
                  <td><span [class]="tagClass(row.buysmartAction)">{{ row.buysmartAction || 'Blank' }}</span></td>
                  <td>{{ row.outcomeReporting }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </article>

      <aside class="panel detail">
        @if (!selected) {
          <div class="empty">Select a row to inspect trace and edit analyst fields.</div>
        } @else {
          <h2>{{ selected.caseNumber || 'Selected row' }}</h2>
          <p class="description">{{ selected.description }}</p>
          <div class="mini-grid">
            <span>DIN <strong>{{ selected.din || '-' }}</strong></span>
            <span>MIN <strong>{{ selected.min || '-' }}</strong></span>
            <span>Status <strong>{{ selected.status }}</strong></span>
          </div>

          <label class="field">
            <span>ACTION</span>
            <input [(ngModel)]="edit.action">
          </label>
          <label class="field">
            <span>If In Stock: Action</span>
            <input [(ngModel)]="edit.ifInStockAction">
          </label>
          <label class="field">
            <span>BuySmart Action</span>
            <input [(ngModel)]="edit.buysmartAction">
          </label>
          <label class="check">
            <input type="checkbox" [(ngModel)]="edit.needsReview">
            Needs review
          </label>
          <label class="field">
            <span>Analyst notes</span>
            <textarea [(ngModel)]="edit.analystNotes"></textarea>
          </label>
          <button class="button" (click)="saveSelected()">Save Row</button>

          <h3>Trace</h3>
          @if (!selected.executionTrace.length) {
            <div class="empty">No executable rule trace yet.</div>
          } @else {
            <ol class="trace-list">
              @for (trace of selected.executionTrace; track trace.runtimeRuleId) {
                <li>
                  <strong>{{ trace.runtimeRuleId }}</strong>
                  <span>{{ trace.description }}</span>
                </li>
              }
            </ol>
          }
        }
      </aside>
    </section>
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

      .filters,
      .table-card,
      .detail {
        padding: 1rem;
      }

      .search {
        flex: 1 1 320px;
      }

      .workbench {
        margin-top: 1rem;
        grid-template-columns: minmax(0, 1.4fr) minmax(320px, 0.6fr);
      }

      .table-meta {
        color: var(--muted);
        font-weight: 800;
        margin-bottom: 0.5rem;
      }

      tr.selected td {
        background: #eff6ff;
      }

      .detail {
        display: grid;
        gap: 0.8rem;
        align-content: start;
      }

      .detail h2,
      .detail h3 {
        margin: 0;
      }

      .description {
        margin: 0;
        color: var(--muted);
        line-height: 1.4;
      }

      .mini-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 0.5rem;
      }

      .mini-grid span {
        display: grid;
        gap: 0.25rem;
        padding: 0.55rem;
        border-radius: 7px;
        background: #f8fafc;
        color: var(--muted);
        font-size: 0.78rem;
      }

      .mini-grid strong {
        color: var(--ink);
        overflow-wrap: anywhere;
      }

      .check {
        display: flex;
        align-items: center;
        gap: 0.45rem;
        color: var(--muted);
        font-weight: 800;
      }

      .trace-list {
        display: grid;
        gap: 0.55rem;
        padding-left: 1.2rem;
        margin: 0;
      }

      .trace-list li span {
        display: block;
        color: var(--muted);
        margin-top: 0.15rem;
      }
    `
  ]
})
export class WorkbenchComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  batches: SourceBatch[] = [];
  rows: WorkflowRow[] = [];
  total = 0;
  selectedBatchId = '';
  search = '';
  needsReview = '';
  selected: WorkflowRow | null = null;
  edit: Partial<WorkflowRow> = {};

  ngOnInit(): void {
    void this.init();
  }

  async init(): Promise<void> {
    this.batches = await this.api.listBatches();
    this.selectedBatchId = this.route.snapshot.queryParamMap.get('batchId') || this.batches[0]?.id || '';
    await this.loadRows();
  }

  async loadRows(): Promise<void> {
    if (!this.selectedBatchId) return;
    const result = await this.api.listRows(this.selectedBatchId, {
      pageSize: 75,
      search: this.search,
      needsReview: this.needsReview || undefined
    });
    this.rows = result.rows;
    this.total = result.total;
    this.selected = this.rows[0] ?? null;
    if (this.selected) this.selectRow(this.selected);
  }

  selectRow(row: WorkflowRow): void {
    this.selected = row;
    this.edit = {
      action: row.action,
      ifInStockAction: row.ifInStockAction,
      buysmartAction: row.buysmartAction,
      needsReview: row.needsReview,
      analystNotes: row.analystNotes
    };
  }

  async saveSelected(): Promise<void> {
    if (!this.selected) return;
    const updated = await this.api.patchRow(this.selected.id, this.edit);
    this.rows = this.rows.map((row) => (row.id === updated.id ? updated : row));
    this.selectRow(updated);
  }

  tagClass(value: string): string {
    const normalized = value.toLowerCase();
    if (normalized.includes('approved')) return 'tag good';
    if (normalized.includes('denied')) return 'tag bad';
    if (normalized.includes('review')) return 'tag warn';
    return 'tag info';
  }
}
