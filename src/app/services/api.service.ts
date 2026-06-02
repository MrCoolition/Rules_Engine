import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, timeout, type Observable } from 'rxjs';
import type { BatchSummary, HealthResponse, RouteManifest, RuleDefinition, RuleRun, SourceBatch, WorkflowRow } from '../models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly statusTimeoutMs = 8000;
  private readonly workTimeoutMs = 120000;

  health(): Promise<HealthResponse> {
    return this.resolve(this.http.get<HealthResponse>('/api/health'));
  }

  routes(): Promise<RouteManifest> {
    return this.resolve(this.http.get<RouteManifest>('/api/routes'));
  }

  bootstrap(): Promise<{ ok: boolean; statements: number; rulesSeeded?: boolean; ruleCount?: number; executableVariantCount?: number }> {
    return this.resolve(this.http.post<{ ok: boolean; statements: number; rulesSeeded?: boolean; ruleCount?: number; executableVariantCount?: number }>('/api/bootstrap', {}));
  }

  listBatches(): Promise<SourceBatch[]> {
    return this.resolve(this.http.get<{ batches: SourceBatch[] }>('/api/batches')).then((res) => res.batches);
  }

  getBatch(batchId: string): Promise<SourceBatch> {
    return this.resolve(this.http.get<{ batch: SourceBatch }>(`/api/batches/${batchId}`)).then((res) => res.batch);
  }

  ingestSample(name?: string): Promise<{ batchId: string; rowCount: number; warnings: string[] }> {
    return this.resolve(this.http.post<{ batchId: string; rowCount: number; warnings: string[] }>('/api/batches/sample', { name }), this.workTimeoutMs);
  }

  uploadWorkbook(file: File, reportingDate: string, name: string): Promise<{ batchId: string; rowCount: number; warnings: string[] }> {
    return this.fileToBase64(file).then((fileBase64) =>
      this.resolve(
        this.http.post<{ batchId: string; rowCount: number; warnings: string[] }>('/api/batches/upload', {
          fileName: file.name,
          fileBase64,
          reportingDate,
          name
        }),
        this.workTimeoutMs
      )
    );
  }

  listRows(batchId: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<{ rows: WorkflowRow[]; total: number; page: number; pageSize: number }> {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== '') query.set(key, String(value));
    });
    const qs = query.toString();
    return this.resolve(this.http.get<{ rows: WorkflowRow[]; total: number; page: number; pageSize: number }>(`/api/batches/${batchId}/rows${qs ? `?${qs}` : ''}`));
  }

  batchSummary(batchId: string): Promise<BatchSummary> {
    return this.resolve(this.http.get<BatchSummary>(`/api/batches/${batchId}/summary`), 30000);
  }

  patchRow(rowId: string, patch: Partial<WorkflowRow>): Promise<WorkflowRow> {
    return this.resolve(this.http.patch<{ row: WorkflowRow }>(`/api/rows/${rowId}`, patch)).then((res) => res.row);
  }

  listRules(): Promise<RuleDefinition[]> {
    return this.resolve(this.http.get<{ rules: RuleDefinition[] }>('/api/rules')).then((res) => res.rules);
  }

  importDefaultDaf(): Promise<{ report: Record<string, unknown>; rules: RuleDefinition[] }> {
    return this.resolve(this.http.post<{ report: Record<string, unknown>; rules: RuleDefinition[] }>('/api/rules/import-daf', {}), this.workTimeoutMs);
  }

  seedRules(force = false): Promise<{ report: Record<string, unknown>; rules: RuleDefinition[]; seeded: boolean }> {
    return this.resolve(this.http.post<{ report: Record<string, unknown>; rules: RuleDefinition[]; seeded: boolean }>('/api/rules/seed', { force }), this.workTimeoutMs);
  }

  importDaf(file: File): Promise<{ report: Record<string, unknown>; rules: RuleDefinition[] }> {
    return this.fileToBase64(file).then((fileBase64) =>
      this.resolve(this.http.post<{ report: Record<string, unknown>; rules: RuleDefinition[] }>('/api/rules/import-daf', { fileName: file.name, fileBase64 }), this.workTimeoutMs)
    );
  }

  runBatch(batchId: string, dryRun = false): Promise<{ run: RuleRun; results: unknown[]; dryRun: boolean }> {
    return this.resolve(this.http.post<{ run: RuleRun; results: unknown[]; dryRun: boolean }>('/api/runs', { batchId, mode: 'full_batch', dryRun }), this.workTimeoutMs);
  }

  exportBatch(batchId: string, format: 'csv' | 'xlsx'): void {
    fetch(`/api/batches/${batchId}/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ format })
    })
      .then((response) => response.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `rules-engine-${batchId}.${format}`;
        link.click();
        URL.revokeObjectURL(url);
      });
  }

  private resolve<T>(request: Observable<T>, ms = this.statusTimeoutMs): Promise<T> {
    return firstValueFrom(request.pipe(timeout({ first: ms })));
  }

  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.readAsDataURL(file);
    });
  }
}
