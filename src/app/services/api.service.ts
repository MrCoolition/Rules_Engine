import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { BatchSummary, HealthResponse, RouteManifest, RuleDefinition, RuleRun, SourceBatch, WorkflowRow } from '../models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  health(): Promise<HealthResponse> {
    return firstValueFrom(this.http.get<HealthResponse>('/api/health'));
  }

  routes(): Promise<RouteManifest> {
    return firstValueFrom(this.http.get<RouteManifest>('/api/routes'));
  }

  bootstrap(): Promise<{ ok: boolean; statements: number }> {
    return firstValueFrom(this.http.post<{ ok: boolean; statements: number }>('/api/bootstrap', {}));
  }

  listBatches(): Promise<SourceBatch[]> {
    return firstValueFrom(this.http.get<{ batches: SourceBatch[] }>('/api/batches')).then((res) => res.batches);
  }

  getBatch(batchId: string): Promise<SourceBatch> {
    return firstValueFrom(this.http.get<{ batch: SourceBatch }>(`/api/batches/${batchId}`)).then((res) => res.batch);
  }

  ingestSample(name?: string): Promise<{ batchId: string; rowCount: number; warnings: string[] }> {
    return firstValueFrom(this.http.post<{ batchId: string; rowCount: number; warnings: string[] }>('/api/batches/sample', { name }));
  }

  uploadWorkbook(file: File, reportingDate: string, name: string): Promise<{ batchId: string; rowCount: number; warnings: string[] }> {
    return this.fileToBase64(file).then((fileBase64) =>
      firstValueFrom(
        this.http.post<{ batchId: string; rowCount: number; warnings: string[] }>('/api/batches/upload', {
          fileName: file.name,
          fileBase64,
          reportingDate,
          name
        })
      )
    );
  }

  listRows(batchId: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<{ rows: WorkflowRow[]; total: number; page: number; pageSize: number }> {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== '') query.set(key, String(value));
    });
    const qs = query.toString();
    return firstValueFrom(this.http.get<{ rows: WorkflowRow[]; total: number; page: number; pageSize: number }>(`/api/batches/${batchId}/rows${qs ? `?${qs}` : ''}`));
  }

  batchSummary(batchId: string): Promise<BatchSummary> {
    return firstValueFrom(this.http.get<BatchSummary>(`/api/batches/${batchId}/summary`));
  }

  patchRow(rowId: string, patch: Partial<WorkflowRow>): Promise<WorkflowRow> {
    return firstValueFrom(this.http.patch<{ row: WorkflowRow }>(`/api/rows/${rowId}`, patch)).then((res) => res.row);
  }

  listRules(): Promise<RuleDefinition[]> {
    return firstValueFrom(this.http.get<{ rules: RuleDefinition[] }>('/api/rules')).then((res) => res.rules);
  }

  importDefaultDaf(): Promise<{ report: Record<string, unknown>; rules: RuleDefinition[] }> {
    return firstValueFrom(this.http.post<{ report: Record<string, unknown>; rules: RuleDefinition[] }>('/api/rules/import-daf', {}));
  }

  importDaf(file: File): Promise<{ report: Record<string, unknown>; rules: RuleDefinition[] }> {
    return this.fileToBase64(file).then((fileBase64) =>
      firstValueFrom(this.http.post<{ report: Record<string, unknown>; rules: RuleDefinition[] }>('/api/rules/import-daf', { fileName: file.name, fileBase64 }))
    );
  }

  runBatch(batchId: string, dryRun = false): Promise<{ run: RuleRun; results: unknown[]; dryRun: boolean }> {
    return firstValueFrom(this.http.post<{ run: RuleRun; results: unknown[]; dryRun: boolean }>('/api/runs', { batchId, mode: 'full_batch', dryRun }));
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

  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.readAsDataURL(file);
    });
  }
}
