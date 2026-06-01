import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../services/api.service';
import type { HealthResponse, RouteManifest } from '../models';

@Component({
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="page-title">
      <div>
        <p>Settings</p>
        <h1>API and environment</h1>
      </div>
      <button class="button" (click)="bootstrap()">Bootstrap Neon Schema</button>
    </section>

    <section class="kpi-grid">
      <article class="panel kpi"><small>Store</small><strong>{{ health?.store || '-' }}</strong></article>
      <article class="panel kpi"><small>Database</small><strong>{{ health?.databaseConfigured ? 'Ready' : 'Memory' }}</strong></article>
      <article class="panel kpi"><small>DAF</small><strong>{{ health?.defaultDafWorkbook ? 'Found' : 'Missing' }}</strong></article>
      <article class="panel kpi"><small>Source</small><strong>{{ health?.defaultSourceWorkbook ? 'Found' : 'Missing' }}</strong></article>
    </section>

    @if (message) {
      <div class="empty settings-message">{{ message }}</div>
    }

    <section class="split route-row">
      <article class="panel route-card">
        <h2>Frontend Routes</h2>
        @for (route of manifest?.frontendRoutes || []; track route.path) {
          <div class="route-line">
            <code>{{ route.path }}</code>
            <span>{{ route.label }}</span>
            <p>{{ route.purpose }}</p>
          </div>
        }
      </article>

      <article class="panel route-card">
        <h2>API Endpoints</h2>
        @for (route of manifest?.apiRoutes || []; track route.method + route.path) {
          <div class="route-line">
            <code>{{ route.method }} {{ route.path }}</code>
            <p>{{ route.purpose }}</p>
          </div>
        }
      </article>
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

      .settings-message,
      .route-row {
        margin-top: 1rem;
      }

      .route-card {
        padding: 1rem;
      }

      .route-card h2 {
        margin: 0 0 0.8rem;
      }

      .route-line {
        padding: 0.7rem 0;
        border-bottom: 1px solid var(--line);
      }

      .route-line code {
        display: inline-block;
        padding: 0.2rem 0.45rem;
        border-radius: 6px;
        background: #eef2ff;
        color: #3730a3;
        font-size: 0.78rem;
        font-weight: 800;
        overflow-wrap: anywhere;
      }

      .route-line span {
        display: block;
        margin-top: 0.35rem;
        font-weight: 800;
      }

      .route-line p {
        margin: 0.35rem 0 0;
        color: var(--muted);
        line-height: 1.35;
      }
    `
  ]
})
export class SettingsComponent implements OnInit {
  private readonly api = inject(ApiService);
  health: HealthResponse | null = null;
  manifest: RouteManifest | null = null;
  message = '';

  ngOnInit(): void {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    [this.health, this.manifest] = await Promise.all([this.api.health(), this.api.routes()]);
  }

  async bootstrap(): Promise<void> {
    const result = await this.api.bootstrap();
    this.message = `Bootstrap complete. Statements applied: ${result.statements}.`;
    await this.refresh();
  }
}
