import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ApiService } from '../services/api.service';
import type { HealthResponse, SourceBatch } from '../models';

@Component({
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <section class="page-title">
      <div>
        <p>System</p>
        <h1>Workspace status</h1>
        <span>Current operating status for workbook processing.</span>
      </div>
      <button class="button secondary" (click)="refresh(true)" [disabled]="loading">{{ loading ? 'Refreshing' : 'Refresh Status' }}</button>
    </section>

    @if (error) {
      <div class="alert bad status-message">{{ error }}</div>
    } @else if (message) {
      <div class="alert good status-message">{{ message }}</div>
    }

    <section class="kpi-grid">
      <article class="panel kpi"><small>Engine</small><strong>{{ loading && !health ? 'Loading' : ready ? 'Ready' : 'Action Needed' }}</strong></article>
      <article class="panel kpi"><small>Rules</small><strong>{{ loading && !health ? 'Loading' : (health?.ruleCount ?? 0) }}</strong></article>
      <article class="panel kpi"><small>Ready Rules</small><strong>{{ loading && !health ? 'Loading' : (health?.executableVariantCount ?? 0) }}</strong></article>
      <article class="panel kpi"><small>Workbooks</small><strong>{{ loading && !batches.length ? 'Loading' : batches.length }}</strong></article>
    </section>

    <section class="split status-row">
      <article class="panel status-card">
        <h2>Processing</h2>
        <div class="status-line">
          <span [class]="ready ? 'tag good' : 'tag bad'">{{ ready ? 'Ready' : 'Action needed' }}</span>
          <p>{{ ready ? 'Workbook processing is available. Upload a PRF/SORF/SRF file to run the saved rules.' : 'Workbook processing is not available right now. Refresh status or contact support.' }}</p>
        </div>
        <div class="status-line">
          <span [class]="ruleReady ? 'tag good' : 'tag bad'">{{ ruleReady ? 'Rules loaded' : 'Rules unavailable' }}</span>
          <p>{{ ruleReady ? (health?.ruleCount ?? 0) + ' saved rules are available, with ' + (health?.executableVariantCount ?? 0) + ' ready to run.' : 'The saved rule catalog is not ready.' }}</p>
        </div>
      </article>

      <article class="panel status-card">
        <h2>Workflow</h2>
        <a routerLink="/upload">Process workbook</a>
        <a routerLink="/reports">View buckets</a>
        <a routerLink="/workbench">Review rows</a>
        <a routerLink="/rules">Browse rules</a>
      </article>
    </section>
  `,
  styles: [
    `
      .page-title span,
      .status-line p {
        color: var(--muted);
      }

      .page-title span {
        display: block;
        margin-top: 0.35rem;
      }

      .status-message,
      .status-row {
        margin-top: 1rem;
      }

      .status-card {
        display: grid;
        align-content: start;
        gap: 0.85rem;
        padding: 1rem;
      }

      .status-card h2,
      .status-line p {
        margin: 0;
      }

      .status-card h2 {
        font-size: 1rem;
      }

      .status-line {
        display: grid;
        gap: 0.35rem;
        padding-top: 0.7rem;
        border-top: 1px solid var(--line);
      }

      .status-card a {
        display: block;
        padding: 0.72rem 0;
        border-top: 1px solid var(--line);
        color: var(--accent-2);
        font-weight: 850;
      }
    `
  ]
})
export class SettingsComponent implements OnInit {
  private readonly api = inject(ApiService);
  health: HealthResponse | null = null;
  batches: SourceBatch[] = [];
  message = '';
  error = '';
  loading = true;

  get ruleReady(): boolean {
    return (this.health?.ruleCount ?? 0) > 0 && (this.health?.executableVariantCount ?? 0) > 0;
  }

  get ready(): boolean {
    return this.health?.databaseConfigured === true && this.ruleReady;
  }

  ngOnInit(): void {
    void this.refresh();
  }

  async refresh(showMessage = false): Promise<void> {
    this.loading = true;
    this.error = '';
    this.message = '';
    try {
      const [health, batches] = await Promise.all([this.api.health(), this.api.listBatches()]);
      this.health = health;
      this.batches = batches;
      this.message = showMessage && this.ready ? 'Status refreshed. Everything is ready.' : '';
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.loading = false;
    }
  }

  private errorMessage(error: unknown): string {
    if (typeof error === 'object' && error && 'error' in error) {
      const wrapped = error as { error?: { error?: string; message?: string } };
      return wrapped.error?.error || wrapped.error?.message || 'Status check failed.';
    }
    return error instanceof Error ? error.message : 'Status check failed.';
  }
}
