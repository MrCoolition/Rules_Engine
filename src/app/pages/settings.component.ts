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
        <h1>System readiness</h1>
      </div>
      <button class="button" (click)="bootstrap()">Repair Schema + Rules</button>
    </section>

    <section class="kpi-grid">
      <article class="panel kpi"><small>Store</small><strong>{{ health?.store || '-' }}</strong></article>
      <article class="panel kpi"><small>Database</small><strong>{{ health?.databaseConfigured ? 'Neon' : 'Missing' }}</strong></article>
      <article class="panel kpi"><small>Rules</small><strong>{{ health?.ruleCount ?? '-' }}</strong></article>
      <article class="panel kpi"><small>Executable</small><strong>{{ health?.executableVariantCount ?? '-' }}</strong></article>
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
        background: #f0f3f6;
        color: var(--ink);
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
    this.message = `Repair complete. Statements checked: ${result.statements}. Rules: ${result.ruleCount ?? 0}. Executable variants: ${result.executableVariantCount ?? 0}.`;
    await this.refresh();
  }
}
