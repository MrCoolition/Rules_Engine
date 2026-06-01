import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../services/api.service';
import type { RuleDefinition, RuleRun, SourceBatch } from '../models';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="page-title">
      <div>
        <p>Execution Console</p>
        <h1>Run governed rules</h1>
      </div>
      <button class="button ghost" (click)="refresh()">Refresh</button>
    </section>

    <section class="panel console">
      <div class="toolbar">
        <label class="field grow">
          <span>Batch</span>
          <select [(ngModel)]="selectedBatchId">
            <option value="">Select batch</option>
            @for (batch of batches; track batch.id) {
              <option [value]="batch.id">{{ batch.name }} ({{ batch.rowCount }} rows)</option>
            }
          </select>
        </label>
        <button class="button secondary" (click)="run(true)" [disabled]="busy || !selectedBatchId">Dry Run</button>
        <button class="button" (click)="run(false)" [disabled]="busy || !selectedBatchId">Execute</button>
      </div>

      <div class="rule-strip">
        <span class="tag info">{{ rules.length }} definitions</span>
        <span class="tag good">{{ executableCount }} executable variants</span>
        <span class="tag warn">{{ guidedCount }} guided/manual variants</span>
      </div>
    </section>

    @if (runResult) {
      <section class="kpi-grid run-grid">
        <article class="panel kpi"><small>Input Rows</small><strong>{{ runResult.inputRowCount }}</strong></article>
        <article class="panel kpi"><small>Changed Rows</small><strong>{{ runResult.changedRowCount }}</strong></article>
        <article class="panel kpi"><small>Review Rows</small><strong>{{ runResult.reviewRowCount }}</strong></article>
        <article class="panel kpi"><small>Status</small><strong>{{ runResult.status }}</strong></article>
      </section>
    }

    @if (message) {
      <div class="empty">{{ message }}</div>
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

      .console {
        padding: 1rem;
      }

      .grow {
        flex: 1 1 320px;
      }

      .rule-strip {
        display: flex;
        flex-wrap: wrap;
        gap: 0.55rem;
        margin-top: 1rem;
      }

      .run-grid {
        margin-top: 1rem;
      }
    `
  ]
})
export class ExecutionConsoleComponent implements OnInit {
  private readonly api = inject(ApiService);
  batches: SourceBatch[] = [];
  rules: RuleDefinition[] = [];
  selectedBatchId = '';
  busy = false;
  message = '';
  runResult: RuleRun | null = null;

  get executableCount(): number {
    return this.rules.flatMap((rule) => rule.variants).filter((variant) => variant.isExecutable).length;
  }

  get guidedCount(): number {
    return this.rules.flatMap((rule) => rule.variants).filter((variant) => !variant.isExecutable).length;
  }

  ngOnInit(): void {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    [this.batches, this.rules] = await Promise.all([this.api.listBatches(), this.api.listRules()]);
    this.selectedBatchId ||= this.batches[0]?.id ?? '';
  }

  async run(dryRun: boolean): Promise<void> {
    if (!this.selectedBatchId) return;
    this.busy = true;
    this.message = '';
    try {
      const result = await this.api.runBatch(this.selectedBatchId, dryRun);
      this.runResult = result.run;
      this.message = result.dryRun ? 'Dry run complete. No rows were saved.' : 'Execution complete and workflow rows were saved.';
    } finally {
      this.busy = false;
    }
  }
}
