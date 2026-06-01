import type { VercelRequest, VercelResponse } from '@vercel/node';
import ExcelJS from 'exceljs';
import { DEFAULT_DAF_PARSED_WORKBOOK } from './_shared/daf-seed.js';
import {
  buildRuleCatalog,
  catalogSnapshot,
  executeRow,
  executeRows,
  summarizeBatch
} from './_shared/engine.js';
import type { JsonValue, RouteManifest, RowExecutionResult, RuleDefinition, RuleImportReport, RuleRun, WorkflowRow } from './_shared/types.js';
import { createWorkflowRow } from './_shared/normalize.js';
import { DEFAULT_DAF_FILE, DEFAULT_SOURCE_FILE, loadWorkbookFile, parseDafWorkbook, parseSourceWorkbook, workbookExists } from './_shared/workbooks.js';
import { getStore, newId } from './_shared/store.js';
import { hasDatabaseUrl } from './_shared/db.js';

const manifest: RouteManifest = {
  frontendRoutes: [
    { path: '/', label: 'Compliance Rules', purpose: 'Rules readiness, recent batches, and processing entry point.' },
    { path: '/upload', label: 'Process PRF', purpose: 'Upload a PRF/SORF/SRF workbook, run DB-backed rules, and show result buckets.' },
    { path: '/execute', label: 'Execution Console', purpose: 'Optional run console for selected batches.' },
    { path: '/workbench', label: 'Analyst Workbench', purpose: 'Search, filter, review, and edit workflow row decisions.' },
    { path: '/reports', label: 'Outcome Reporting', purpose: 'Rollups, coverage, and CSV/XLSX export.' },
    { path: '/rules', label: 'Rule Catalog', purpose: 'Browse and sync the DB-backed compliance rule catalog.' },
    { path: '/settings', label: 'Settings', purpose: 'Environment health, schema bootstrap, and API route manifest.' }
  ],
  apiRoutes: [
    { method: 'GET', path: '/api/health', purpose: 'Environment, database, and seeded rule readiness.' },
    { method: 'GET', path: '/api/routes', purpose: 'Frontend and API route manifest.' },
    { method: 'POST', path: '/api/bootstrap', purpose: 'Create Neon schema tables and indexes.' },
    { method: 'GET', path: '/api/batches', purpose: 'List source batches.' },
    { method: 'POST', path: '/api/batches/upload', purpose: 'Upload a PRF/SORF/SRF workbook as base64 JSON.' },
    { method: 'POST', path: '/api/batches/sample', purpose: 'Local-only sample ingestion when a workspace workbook exists.' },
    { method: 'GET', path: '/api/batches/:batchId', purpose: 'Batch metadata and KPI summary.' },
    { method: 'DELETE', path: '/api/batches/:batchId', purpose: 'Archive a batch.' },
    { method: 'GET', path: '/api/batches/:batchId/rows', purpose: 'Paginated/filterable workflow rows.' },
    { method: 'GET', path: '/api/batches/:batchId/summary', purpose: 'Batch KPI and chart-ready summary.' },
    { method: 'POST', path: '/api/batches/:batchId/export', purpose: 'Export CSV or XLSX outcomes.' },
    { method: 'PATCH', path: '/api/rows/:rowId', purpose: 'Patch analyst-editable row fields with audit.' },
    { method: 'GET', path: '/api/rules', purpose: 'List DAF-derived rule definitions and seed the catalog if empty.' },
    { method: 'POST', path: '/api/rules/seed', purpose: 'Seed Neon with the bundled DAF-derived rule catalog.' },
    { method: 'POST', path: '/api/rules/import-daf', purpose: 'Admin-only rule catalog import override. Normal processing uses bundled DB rules.' },
    { method: 'GET', path: '/api/rules/:ruleId', purpose: 'Rule details, version, and variants.' },
    { method: 'POST', path: '/api/rules/:ruleId/versions', purpose: 'Create a draft version from the current rule.' },
    { method: 'PATCH', path: '/api/rules/versions/:versionId', purpose: 'Edit draft/ready version metadata and variants.' },
    { method: 'POST', path: '/api/rules/versions/:versionId/approve', purpose: 'Approve a rule version for execution.' },
    { method: 'POST', path: '/api/rules/variants/:variantId/test', purpose: 'Test one variant against a row or raw sample without persisting.' },
    { method: 'POST', path: '/api/rules/simulate', purpose: 'Run rules against one row without persisting.' },
    { method: 'POST', path: '/api/runs', purpose: 'Execute approved rule variants against a batch.' },
    { method: 'GET', path: '/api/runs/:runId', purpose: 'Run metadata and counts.' },
    { method: 'GET', path: '/api/runs/:runId/results', purpose: 'Row-level before/after execution trace results.' }
  ]
};

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  setCommonHeaders(res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const path = getPath(req);
  const store = getStore();

  try {
    if (req.method === 'GET' && pathEquals(path, 'health')) {
      const seededCatalog = await getSeededRuleCatalog(store);
      sendJson(res, 200, {
        ok: true,
        store: store.kind,
        databaseConfigured: hasDatabaseUrl(),
        defaultDafWorkbook: await workbookExists(DEFAULT_DAF_FILE),
        defaultSourceWorkbook: await workbookExists(DEFAULT_SOURCE_FILE),
        rulesSeeded: seededCatalog.seeded,
        ruleCount: seededCatalog.rules.length,
        executableVariantCount: seededCatalog.report.executableVariants,
        timestamp: new Date().toISOString()
      });
      return;
    }

    if (req.method === 'GET' && pathEquals(path, 'routes')) {
      sendJson(res, 200, manifest);
      return;
    }

    if (req.method === 'POST' && pathEquals(path, 'bootstrap')) {
      const result = await store.bootstrap();
      const seededCatalog = await getSeededRuleCatalog(store);
      const payload = {
        ...result,
        rulesSeeded: seededCatalog.seeded,
        ruleCount: seededCatalog.rules.length,
        executableVariantCount: seededCatalog.report.executableVariants
      };
      await store.audit('schema.bootstrap', 'system', null, payload);
      sendJson(res, 200, payload);
      return;
    }

    if (req.method === 'GET' && pathEquals(path, 'batches')) {
      sendJson(res, 200, { batches: await store.listBatches() });
      return;
    }

    if (req.method === 'POST' && pathEquals(path, 'batches', 'upload')) {
      const body = await readJson(req);
      const fileName = stringBody(body['fileName']) || 'upload.xlsx';
      const fileBase64 = stringBody(body['fileBase64']);
      if (!fileBase64) throw httpError(400, 'fileBase64 is required.');
      const parsed = await parseSourceWorkbook(fileName, base64ToBuffer(fileBase64));
      const batch = await store.createBatch(parsed, {
        name: stringBody(body['name']) || fileName,
        reportingDate: stringBody(body['reportingDate']) || today(),
        sourceKind: 'upload'
      });
      await store.audit('batch.uploaded', 'source_batch', batch.id, { fileName, rowCount: parsed.rows.length });
      sendJson(res, 200, { batchId: batch.id, rowCount: batch.rowCount, sourceSheetName: batch.sourceSheetName, columns: parsed.columns, warnings: parsed.warnings });
      return;
    }

    if (req.method === 'POST' && pathEquals(path, 'batches', 'sample')) {
      const body = await readJson(req, true);
      const buffer = await loadWorkbookFile(DEFAULT_SOURCE_FILE);
      const parsed = await parseSourceWorkbook(DEFAULT_SOURCE_FILE, buffer);
      const batch = await store.createBatch(parsed, {
        name: stringBody(body['name']) || 'Standard PRF/SORF/SRF sample',
        reportingDate: stringBody(body['reportingDate']) || today(),
        sourceKind: 'sample'
      });
      sendJson(res, 200, { batchId: batch.id, rowCount: batch.rowCount, sourceSheetName: batch.sourceSheetName, columns: parsed.columns, warnings: parsed.warnings });
      return;
    }

    if (path[0] === 'batches' && path[1] && path.length === 2 && req.method === 'GET') {
      const batch = await store.getBatch(path[1]);
      if (!batch) throw httpError(404, 'Batch not found.');
      sendJson(res, 200, { batch });
      return;
    }

    if (path[0] === 'batches' && path[1] && path.length === 2 && req.method === 'DELETE') {
      sendJson(res, 200, { archived: await store.archiveBatch(path[1]) });
      return;
    }

    if (path[0] === 'batches' && path[1] && path[2] === 'rows' && req.method === 'GET') {
      sendJson(res, 200, await store.listRows(path[1], getUrl(req).searchParams));
      return;
    }

    if (path[0] === 'batches' && path[1] && path[2] === 'summary' && req.method === 'GET') {
      const rows = await store.getRows(path[1]);
      sendJson(res, 200, summarizeBatch(rows));
      return;
    }

    if (path[0] === 'batches' && path[1] && path[2] === 'export' && req.method === 'POST') {
      const body = await readJson(req, true);
      const format = (stringBody(body['format']) || 'csv').toLowerCase();
      const rows = await store.getRows(path[1]);
      if (format === 'xlsx') {
        const buffer = await exportXlsx(rows);
        sendFile(res, 200, buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', `rules-engine-${path[1]}.xlsx`);
      } else {
        const csv = exportCsv(rows);
        sendFile(res, 200, Buffer.from(csv, 'utf8'), 'text/csv; charset=utf-8', `rules-engine-${path[1]}.csv`);
      }
      await store.audit('batch.exported', 'source_batch', path[1], { format });
      return;
    }

    if (path[0] === 'rows' && path[1] && req.method === 'PATCH') {
      const row = await store.updateRow(path[1], await readJson(req));
      if (!row) throw httpError(404, 'Row not found.');
      sendJson(res, 200, { row });
      return;
    }

    if (req.method === 'GET' && pathEquals(path, 'rules')) {
      const seededCatalog = await getSeededRuleCatalog(store);
      sendJson(res, 200, seededCatalog);
      return;
    }

    if (req.method === 'POST' && pathEquals(path, 'rules', 'seed')) {
      const body = await readJson(req, true);
      const seededCatalog = await getSeededRuleCatalog(store, Boolean(body['force']));
      sendJson(res, 200, seededCatalog);
      return;
    }

    if (req.method === 'POST' && pathEquals(path, 'rules', 'import-daf')) {
      const body = await readJson(req, true);
      const fileName = stringBody(body['fileName']) || DEFAULT_DAF_FILE;
      const parsed = body['fileBase64']
        ? await parseDafWorkbook(fileName, base64ToBuffer(stringBody(body['fileBase64'])))
        : DEFAULT_DAF_PARSED_WORKBOOK;
      const { rules, report } = buildRuleCatalog(parsed);
      await store.replaceRuleCatalog(rules);
      sendJson(res, 200, { report, rules });
      return;
    }

    if (path[0] === 'rules' && path[1] && path[2] === 'versions' && path.length === 3 && req.method === 'POST') {
      const rules = await store.listRules();
      const rule = rules.find((item) => item.ruleId === path[1]);
      if (!rule) throw httpError(404, 'Rule not found.');
      const draftVersionId = newId();
      rule.versionId = draftVersionId;
      rule.versionNumber += 1;
      rule.status = 'draft';
      rule.automationLevel = 'guided';
      rule.updatedAt = new Date().toISOString();
      rule.variants = rule.variants.map((variant, index) => ({
        ...variant,
        id: newId(),
        ruleVersionId: draftVersionId,
        runtimeRuleId: `${rule.ruleId}.${String(index + 1).padStart(2, '0')}`,
        status: 'draft',
        enabled: false
      }));
      await store.replaceRuleCatalog(rules);
      await store.audit('rule.version.created', 'rule_definition', rule.id, { ruleId: rule.ruleId, versionId: draftVersionId });
      sendJson(res, 200, { rule });
      return;
    }

    if (path[0] === 'rules' && path[1] === 'versions' && path[2] && path.length === 3 && req.method === 'PATCH') {
      const body = await readJson(req);
      const rules = await store.listRules();
      const rule = rules.find((item) => item.versionId === path[2]);
      if (!rule) throw httpError(404, 'Rule version not found.');
      if (body['status']) rule.status = stringBody(body['status']) as typeof rule.status;
      if (body['automationLevel']) rule.automationLevel = stringBody(body['automationLevel']) as typeof rule.automationLevel;
      if (body['notes']) rule.notes = stringBody(body['notes']);
      if (Array.isArray(body['variants'])) {
        const variantsById = new Map(rule.variants.map((variant) => [variant.id, variant]));
        for (const patch of body['variants'] as Record<string, unknown>[]) {
          const variant = variantsById.get(stringBody(patch['id']));
          if (!variant) continue;
          if (patch['enabled'] !== undefined) variant.enabled = Boolean(patch['enabled']);
          if (patch['status']) variant.status = stringBody(patch['status']) as typeof variant.status;
          if (patch['predicateJson'] !== undefined) variant.predicateJson = patch['predicateJson'] as typeof variant.predicateJson;
          if (patch['actionJson'] !== undefined) variant.actionJson = patch['actionJson'] as typeof variant.actionJson;
          if (patch['description']) variant.description = stringBody(patch['description']);
        }
      }
      rule.updatedAt = new Date().toISOString();
      await store.replaceRuleCatalog(rules);
      await store.audit('rule.version.updated', 'rule_version', path[2], { fields: Object.keys(body) });
      sendJson(res, 200, { rule });
      return;
    }

    if (path[0] === 'rules' && path[1] === 'versions' && path[2] && path[3] === 'approve' && req.method === 'POST') {
      const rules = await store.listRules();
      const rule = rules.find((item) => item.versionId === path[2]);
      if (!rule) throw httpError(404, 'Rule version not found.');
      rule.status = 'approved';
      rule.variants = rule.variants.map((variant) => ({
        ...variant,
        status: variant.isExecutable ? 'approved' : 'ready',
        enabled: variant.isExecutable
      }));
      rule.updatedAt = new Date().toISOString();
      await store.replaceRuleCatalog(rules);
      await store.audit('rule.version.approved', 'rule_version', path[2], { ruleId: rule.ruleId });
      sendJson(res, 200, { rule });
      return;
    }

    if (path[0] === 'rules' && path[1] === 'variants' && path[2] && path[3] === 'test' && req.method === 'POST') {
      const body = await readJson(req);
      const rules = await store.listRules();
      const variant = rules.flatMap((rule) => rule.variants).find((item) => item.id === path[2] || item.runtimeRuleId === path[2]);
      if (!variant) throw httpError(404, 'Rule variant not found.');
      const row = await rowFromRequestBody(store, body);
      const executableVariant = { ...variant, enabled: true, isExecutable: true, status: 'approved' as const };
      sendJson(res, 200, { before: row, after: executeRow(row, [executableVariant]) });
      return;
    }

    if (path[0] === 'rules' && path[1] && path.length === 2 && req.method === 'GET') {
      const rule = await store.getRule(path[1]);
      if (!rule) throw httpError(404, 'Rule not found.');
      sendJson(res, 200, { rule });
      return;
    }

    if (req.method === 'POST' && pathEquals(path, 'rules', 'simulate')) {
      const body = await readJson(req);
      const rules = await store.listRules();
      const row = await rowFromRequestBody(store, body);
      const variants = rules.flatMap((rule) => rule.variants).filter((variant) => variant.enabled && variant.isExecutable && variant.status === 'approved');
      sendJson(res, 200, { before: row, after: executeRow(row, variants) });
      return;
    }

    if (req.method === 'POST' && pathEquals(path, 'runs')) {
      const body = await readJson(req);
      const batchId = stringBody(body['batchId']);
      if (!batchId) throw httpError(400, 'batchId is required.');
      const rowIds = Array.isArray(body['rowIds']) ? body['rowIds'].map(String) : undefined;
      const dryRun = Boolean(body['dryRun']);
      const beforeRows = await store.getRows(batchId);
      const { rules } = await getSeededRuleCatalog(store);
      const executableRuleCount = rules.flatMap((rule) => rule.variants).filter((variant) => variant.enabled && variant.isExecutable && variant.status === 'approved').length;
      if (executableRuleCount === 0) {
        throw httpError(409, 'No approved executable rules are loaded in the database.');
      }
      const executed = executeRows(beforeRows, rules, rowIds);
      const run = createRuleRun(batchId, stringBody(body['mode']) || 'full_batch', beforeRows.length, executed.changedCount, executed.reviewCount, catalogSnapshot(rules));
      const results = createResults(run.id, beforeRows, executed.rows, rowIds);
      if (!dryRun) await store.createRun(run, results, executed.rows);
      sendJson(res, 200, { run, results: results.slice(0, 50), dryRun });
      return;
    }

    if (path[0] === 'runs' && path[1] && path.length === 2 && req.method === 'GET') {
      const run = await store.getRun(path[1]);
      if (!run) throw httpError(404, 'Run not found.');
      sendJson(res, 200, { run });
      return;
    }

    if (path[0] === 'runs' && path[1] && path[2] === 'results' && req.method === 'GET') {
      sendJson(res, 200, { results: await store.listRunResults(path[1]) });
      return;
    }

    throw httpError(404, `No route for ${req.method} /api/${path.join('/')}`);
  } catch (error) {
    const status = typeof error === 'object' && error && 'statusCode' in error ? Number((error as { statusCode: number }).statusCode) : 500;
    const message = error instanceof Error ? error.message : 'Unexpected error.';
    sendJson(res, status, { ok: false, error: message });
  }
}

async function rowFromRequestBody(store: ReturnType<typeof getStore>, body: Record<string, unknown>): Promise<WorkflowRow> {
  if (body['batchId'] && body['rowId']) {
    const rows = await store.getRows(stringBody(body['batchId']));
    const row = rows.find((item) => item.id === body['rowId']);
    if (row) return row;
  }
  if (body['rawRow'] && typeof body['rawRow'] === 'object') {
    return createWorkflowRow('simulation', body['rawRow'] as Record<string, JsonValue>, 1, new Date().toISOString(), newId);
  }
  throw httpError(400, 'Provide batchId + rowId or rawRow.');
}

async function getSeededRuleCatalog(
  store: ReturnType<typeof getStore>,
  force = false
): Promise<{ rules: RuleDefinition[]; report: RuleImportReport; seeded: boolean }> {
  await store.bootstrap();
  const existingRules = await store.listRules();
  if (!force && existingRules.length > 0) {
    return { rules: existingRules, report: reportFromRules(existingRules), seeded: false };
  }

  const { rules, report } = buildRuleCatalog(DEFAULT_DAF_PARSED_WORKBOOK);
  try {
    await store.replaceRuleCatalog(rules);
    await store.audit('rules.seeded', 'rule_catalog', null, {
      source: DEFAULT_DAF_PARSED_WORKBOOK.fileName,
      force,
      ruleCount: rules.length,
      executableVariantCount: report.executableVariants
    });
    return { rules, report, seeded: true };
  } catch (error) {
    const recoveredRules = await store.listRules().catch(() => []);
    if (recoveredRules.length > 0) return { rules: recoveredRules, report: reportFromRules(recoveredRules), seeded: false };
    throw error;
  }
}

function reportFromRules(rules: RuleDefinition[]): RuleImportReport {
  const variants = rules.flatMap((rule) => rule.variants);
  return {
    created: 0,
    updated: 0,
    unchanged: rules.length,
    warnings: [],
    duplicateRuleIds: [],
    sheetNames: DEFAULT_DAF_PARSED_WORKBOOK.sheetNames,
    executableVariants: variants.filter((variant) => variant.enabled && variant.isExecutable && variant.status === 'approved').length,
    guidedVariants: variants.filter((variant) => variant.automationLevel === 'guided').length,
    manualVariants: variants.filter((variant) => variant.automationLevel === 'manual' || variant.automationLevel === 'future').length
  };
}

function createRuleRun(
  batchId: string,
  mode: string,
  inputRowCount: number,
  changedRowCount: number,
  reviewRowCount: number,
  snapshot: RuleRun['ruleVersionSnapshot']
): RuleRun {
  const now = new Date().toISOString();
  return {
    id: newId(),
    batchId,
    status: 'completed',
    runMode: mode === 'selected_rows' ? 'selected_rows' : 'full_batch',
    ruleVersionSnapshot: snapshot,
    inputRowCount,
    changedRowCount,
    reviewRowCount,
    errorMessage: '',
    startedAt: now,
    completedAt: now
  };
}

function createResults(runId: string, beforeRows: WorkflowRow[], afterRows: WorkflowRow[], rowIds?: string[]): RowExecutionResult[] {
  const selected = rowIds?.length ? new Set(rowIds) : null;
  const beforeById = new Map(beforeRows.map((row) => [row.id, row]));
  return afterRows
    .filter((row) => !selected || selected.has(row.id))
    .filter((row) => JSON.stringify(decision(row)) !== JSON.stringify(decision(beforeById.get(row.id))) || row.executionTrace.length > 0)
    .map((row) => {
      const before = beforeById.get(row.id) ?? row;
      return {
        id: newId(),
        runId,
        workflowRowId: row.id,
        beforeState: before,
        afterState: row,
        trace: row.executionTrace,
        rulesApplied: row.executionTrace.map((trace) => trace.runtimeRuleId),
        validations: row.validationStatus ? row.validationStatus.split(';').map((item) => item.trim()) : [],
        createdAt: new Date().toISOString()
      };
    });
}

function decision(row?: WorkflowRow): Record<string, unknown> {
  if (!row) return {};
  return {
    action: row.action,
    ifInStockAction: row.ifInStockAction,
    buysmartAction: row.buysmartAction,
    needsReview: row.needsReview,
    excluded: row.excluded,
    outcome: row.outcomeReporting
  };
}

async function exportXlsx(rows: WorkflowRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Rules Execution Engine';
  const worksheet = workbook.addWorksheet('Outcomes');
  const headers = exportHeaders();
  worksheet.addRow(headers);
  rows.forEach((row) => worksheet.addRow(headers.map((header) => exportValue(row, header))));
  worksheet.getRow(1).font = { bold: true };
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.columns.forEach((column) => {
    column.width = Math.min(Math.max(String(column.header ?? '').length + 4, 14), 36);
  });
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function exportCsv(rows: WorkflowRow[]): string {
  const headers = exportHeaders();
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => csvCell(exportValue(row, header))).join(','));
  }
  return lines.join('\n');
}

function exportHeaders(): string[] {
  return [
    'Business',
    'Type',
    'Case#',
    'Vendor',
    'DIN',
    'MIN',
    'Description',
    'ACTION',
    'If In Stock: Action',
    'Buysmart Action',
    'Rule Applied',
    'Needs Review',
    'Validation Status',
    'Excluded',
    'Excluded Reason',
    'Outcome Reporting',
    'Analyst Notes'
  ];
}

function exportValue(row: WorkflowRow, header: string): string | number | boolean | null {
  const values: Record<string, string | number | boolean | null> = {
    Business: row.business,
    Type: row.requestType,
    'Case#': row.caseNumber,
    Vendor: row.vendor,
    DIN: row.din,
    MIN: row.min,
    Description: row.description,
    ACTION: row.action,
    'If In Stock: Action': row.ifInStockAction,
    'Buysmart Action': row.buysmartAction,
    'Rule Applied': row.ruleApplied,
    'Needs Review': row.needsReview,
    'Validation Status': row.validationStatus,
    Excluded: row.excluded,
    'Excluded Reason': row.excludedReason,
    'Outcome Reporting': row.outcomeReporting,
    'Analyst Notes': row.analystNotes
  };
  return values[header] ?? '';
}

function csvCell(value: string | number | boolean | null): string {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function getPath(req: VercelRequest): string[] {
  const raw = req.query['path'];
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') return raw.split('/').filter(Boolean);
  return [];
}

function pathEquals(path: string[], ...parts: string[]): boolean {
  return path.length === parts.length && parts.every((part, index) => path[index] === part);
}

function getUrl(req: VercelRequest): URL {
  const host = req.headers.host ?? 'localhost';
  return new URL(req.url ?? '/', `http://${host}`);
}

async function readJson(req: VercelRequest, optional = false): Promise<Record<string, unknown>> {
  if (req.body && typeof req.body === 'object') return req.body as Record<string, unknown>;
  if (typeof req.body === 'string' && req.body.trim()) return JSON.parse(req.body) as Record<string, unknown>;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw && optional) return {};
  if (!raw) throw httpError(400, 'JSON body is required.');
  return JSON.parse(raw) as Record<string, unknown>;
}

function base64ToBuffer(value: string): Buffer {
  const clean = value.includes(',') ? value.split(',').pop() ?? '' : value;
  return Buffer.from(clean, 'base64');
}

function stringBody(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function sendJson(res: VercelResponse, status: number, payload: unknown): void {
  res.status(status).json(payload);
}

function sendFile(res: VercelResponse, status: number, body: Buffer, contentType: string, fileName: string): void {
  res.setHeader('content-type', contentType);
  res.setHeader('content-disposition', `attachment; filename="${fileName}"`);
  res.status(status).send(body);
}

function setCommonHeaders(res: VercelResponse): void {
  res.setHeader('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
  res.setHeader('x-rules-engine', 'compliance-rules');
}

function httpError(statusCode: number, message: string): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}
