import crypto from 'node:crypto';
import type {
  BatchSummary,
  ParsedSourceWorkbook,
  PagedRows,
  RowExecutionResult,
  RuleDefinition,
  RuleRun,
  SourceBatch,
  JsonValue,
  WorkflowRow
} from './types.js';
import { applyRowPatch, filterRows, summarizeBatch } from './engine.js';
import { createWorkflowRow } from './normalize.js';
import { getDb, hasDatabaseUrl, query } from './db.js';
import { MIGRATION_STATEMENTS } from './migrations.js';

interface RulesStore {
  kind: 'memory' | 'neon';
  bootstrap(): Promise<{ ok: boolean; statements: number }>;
  listBatches(): Promise<SourceBatch[]>;
  getBatch(batchId: string): Promise<SourceBatch | null>;
  createBatch(parsed: ParsedSourceWorkbook, input: { name: string; reportingDate: string; sourceKind: SourceBatch['sourceKind'] }): Promise<SourceBatch>;
  archiveBatch(batchId: string): Promise<boolean>;
  listRows(batchId: string, query: URLSearchParams): Promise<PagedRows>;
  getRows(batchId: string): Promise<WorkflowRow[]>;
  replaceRows(batchId: string, rows: WorkflowRow[]): Promise<void>;
  updateRow(rowId: string, patch: Record<string, unknown>): Promise<WorkflowRow | null>;
  replaceRuleCatalog(rules: RuleDefinition[]): Promise<void>;
  listRules(): Promise<RuleDefinition[]>;
  getRule(ruleId: string): Promise<RuleDefinition | null>;
  createRun(run: RuleRun, results: RowExecutionResult[], rows: WorkflowRow[]): Promise<RuleRun>;
  getRun(runId: string): Promise<RuleRun | null>;
  listRunResults(runId: string): Promise<RowExecutionResult[]>;
  audit(eventType: string, entityType: string, entityId: string | null, payload: unknown): Promise<void>;
}

interface MemoryState {
  batches: SourceBatch[];
  rows: WorkflowRow[];
  rules: RuleDefinition[];
  runs: RuleRun[];
  results: RowExecutionResult[];
  audit: unknown[];
}

const globalMemory = globalThis as typeof globalThis & { __rulesEngineMemory?: MemoryState };

function memoryState(): MemoryState {
  if (!globalMemory.__rulesEngineMemory) {
    globalMemory.__rulesEngineMemory = {
      batches: [],
      rows: [],
      rules: [],
      runs: [],
      results: [],
      audit: []
    };
  }
  return globalMemory.__rulesEngineMemory;
}

export function getStore(): RulesStore {
  if (hasDatabaseUrl() && process.env['USE_MEMORY_STORE'] !== '1') return new NeonStore();
  return new MemoryStore();
}

export function newId(): string {
  return crypto.randomUUID();
}

class MemoryStore implements RulesStore {
  readonly kind = 'memory' as const;
  private readonly state = memoryState();

  async bootstrap(): Promise<{ ok: boolean; statements: number }> {
    return { ok: true, statements: 0 };
  }

  async listBatches(): Promise<SourceBatch[]> {
    return [...this.state.batches].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getBatch(batchId: string): Promise<SourceBatch | null> {
    const batch = this.state.batches.find((item) => item.id === batchId);
    if (!batch) return null;
    return { ...batch, summary: summarizeBatch(this.state.rows.filter((row) => row.batchId === batchId)) };
  }

  async createBatch(parsed: ParsedSourceWorkbook, input: { name: string; reportingDate: string; sourceKind: SourceBatch['sourceKind'] }): Promise<SourceBatch> {
    const now = new Date().toISOString();
    const batch: SourceBatch = {
      id: newId(),
      name: input.name || parsed.fileName,
      sourceKind: input.sourceKind,
      reportingDate: input.reportingDate,
      status: 'draft',
      rowCount: parsed.rows.length,
      sourceFileName: parsed.fileName,
      sourceSheetName: parsed.sheetName,
      fileSha256: parsed.fileSha256,
      createdAt: now,
      updatedAt: now
    };
    const rows = parsed.rows.map((row, index) => createWorkflowRow(batch.id, row, index + 2, now, newId));
    this.state.batches = [batch, ...this.state.batches];
    this.state.rows = [...this.state.rows.filter((row) => row.batchId !== batch.id), ...rows];
    return batch;
  }

  async archiveBatch(batchId: string): Promise<boolean> {
    const batch = this.state.batches.find((item) => item.id === batchId);
    if (!batch) return false;
    batch.status = 'archived';
    batch.updatedAt = new Date().toISOString();
    return true;
  }

  async listRows(batchId: string, queryParams: URLSearchParams): Promise<PagedRows> {
    return filterRows(this.state.rows.filter((row) => row.batchId === batchId), queryParams);
  }

  async getRows(batchId: string): Promise<WorkflowRow[]> {
    return this.state.rows.filter((row) => row.batchId === batchId);
  }

  async replaceRows(batchId: string, rows: WorkflowRow[]): Promise<void> {
    this.state.rows = [...this.state.rows.filter((row) => row.batchId !== batchId), ...rows];
    const batch = this.state.batches.find((item) => item.id === batchId);
    if (batch) {
      batch.status = 'processed';
      batch.updatedAt = new Date().toISOString();
    }
  }

  async updateRow(rowId: string, patch: Record<string, unknown>): Promise<WorkflowRow | null> {
    const index = this.state.rows.findIndex((row) => row.id === rowId);
    if (index < 0) return null;
    const next = applyRowPatch(this.state.rows[index], patch);
    this.state.rows[index] = next;
    return next;
  }

  async replaceRuleCatalog(rules: RuleDefinition[]): Promise<void> {
    this.state.rules = rules;
  }

  async listRules(): Promise<RuleDefinition[]> {
    return this.state.rules;
  }

  async getRule(ruleId: string): Promise<RuleDefinition | null> {
    return this.state.rules.find((rule) => rule.ruleId === ruleId) ?? null;
  }

  async createRun(run: RuleRun, results: RowExecutionResult[], rows: WorkflowRow[]): Promise<RuleRun> {
    this.state.runs = [run, ...this.state.runs];
    this.state.results = [...results, ...this.state.results];
    await this.replaceRows(run.batchId, rows);
    return run;
  }

  async getRun(runId: string): Promise<RuleRun | null> {
    return this.state.runs.find((run) => run.id === runId) ?? null;
  }

  async listRunResults(runId: string): Promise<RowExecutionResult[]> {
    return this.state.results.filter((result) => result.runId === runId);
  }

  async audit(eventType: string, entityType: string, entityId: string | null, payload: unknown): Promise<void> {
    this.state.audit.push({ id: newId(), eventType, entityType, entityId, payload, createdAt: new Date().toISOString() });
  }
}

class NeonStore implements RulesStore {
  readonly kind = 'neon' as const;

  async bootstrap(): Promise<{ ok: boolean; statements: number }> {
    for (const statement of MIGRATION_STATEMENTS) {
      await query(statement);
    }
    return { ok: true, statements: MIGRATION_STATEMENTS.length };
  }

  async listBatches(): Promise<SourceBatch[]> {
    getDb();
    const rows = await query<Record<string, unknown>>(
      `select id, name, source_kind, reporting_date, status, row_count, source_file_name,
        source_sheet_name, file_sha256, created_at, updated_at
       from source_batches
       order by created_at desc`
    );
    return rows.map(dbBatchToSourceBatch);
  }

  async getBatch(batchId: string): Promise<SourceBatch | null> {
    const rows = await query<Record<string, unknown>>(
      `select id, name, source_kind, reporting_date, status, row_count, source_file_name,
        source_sheet_name, file_sha256, created_at, updated_at
       from source_batches
       where id = $1
       limit 1`,
      [batchId]
    );
    const batch = rows[0] ? dbBatchToSourceBatch(rows[0]) : null;
    if (!batch) return null;
    batch.summary = summarizeBatch(await this.getRows(batchId));
    return batch;
  }

  async createBatch(parsed: ParsedSourceWorkbook, input: { name: string; reportingDate: string; sourceKind: SourceBatch['sourceKind'] }): Promise<SourceBatch> {
    const now = new Date().toISOString();
    const batch: SourceBatch = {
      id: newId(),
      name: input.name || parsed.fileName,
      sourceKind: input.sourceKind,
      reportingDate: input.reportingDate,
      status: 'draft',
      rowCount: parsed.rows.length,
      sourceFileName: parsed.fileName,
      sourceSheetName: parsed.sheetName,
      fileSha256: parsed.fileSha256,
      createdAt: now,
      updatedAt: now
    };
    await query(
      `insert into source_batches
        (id, name, source_kind, reporting_date, status, row_count, source_file_name, source_sheet_name, file_sha256, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        batch.id,
        batch.name,
        batch.sourceKind,
        batch.reportingDate,
        batch.status,
        batch.rowCount,
        batch.sourceFileName,
        batch.sourceSheetName,
        batch.fileSha256,
        batch.createdAt,
        batch.updatedAt
      ]
    );
    const workflowRows = parsed.rows.map((row, index) => createWorkflowRow(batch.id, row, index + 2, now, newId));
    await insertWorkflowRows(workflowRows);
    await this.audit('batch.created', 'source_batch', batch.id, { fileName: parsed.fileName, rowCount: parsed.rows.length });
    return batch;
  }

  async archiveBatch(batchId: string): Promise<boolean> {
    await query(`update source_batches set status = 'archived', updated_at = now() where id = $1`, [batchId]);
    await this.audit('batch.archived', 'source_batch', batchId, {});
    return true;
  }

  async listRows(batchId: string, queryParams: URLSearchParams): Promise<PagedRows> {
    return filterRows(await this.getRows(batchId), queryParams);
  }

  async getRows(batchId: string): Promise<WorkflowRow[]> {
    const rows = await query<Record<string, unknown>>(
      `select * from workflow_rows where batch_id = $1 order by source_row_number asc`,
      [batchId]
    );
    return rows.map(dbRowToWorkflowRow);
  }

  async replaceRows(batchId: string, rows: WorkflowRow[]): Promise<void> {
    for (const row of rows) {
      await updateWorkflowRow(row);
    }
    await query(`update source_batches set status = 'processed', updated_at = now() where id = $1`, [batchId]);
  }

  async updateRow(rowId: string, patch: Record<string, unknown>): Promise<WorkflowRow | null> {
    const rows = await query<Record<string, unknown>>(`select * from workflow_rows where id = $1 limit 1`, [rowId]);
    if (!rows[0]) return null;
    const before = dbRowToWorkflowRow(rows[0]);
    const after = applyRowPatch(before, patch);
    await updateWorkflowRow(after);
    for (const key of Object.keys(patch)) {
      await query(
        `insert into analyst_overrides (id, workflow_row_id, field_name, old_value, new_value, reason, created_at)
         values ($1,$2,$3,$4,$5,$6,now())`,
        [
          newId(),
          rowId,
          key,
          String((before as unknown as Record<string, unknown>)[key] ?? ''),
          String((after as unknown as Record<string, unknown>)[key] ?? ''),
          'Analyst edit'
        ]
      );
    }
    await this.audit('row.updated', 'workflow_row', rowId, { fields: Object.keys(patch) });
    return after;
  }

  async replaceRuleCatalog(rules: RuleDefinition[]): Promise<void> {
    await query(`delete from rule_definitions`);
    for (const rule of rules) {
      await query(
        `insert into rule_definitions
          (id, rule_id, name, rule_group, business_scope, request_types, discovery_reference, notes, owner_team, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11)`,
        [
          rule.id,
          rule.ruleId,
          rule.name,
          rule.ruleGroup,
          rule.businessScope,
          JSON.stringify(rule.requestTypes),
          rule.discoveryReference,
          rule.notes,
          rule.ownerTeam,
          rule.createdAt,
          rule.updatedAt
        ]
      );
      await query(
        `insert into rule_versions
          (id, rule_definition_id, version_number, status, automation_level, change_reason, created_at)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [rule.versionId, rule.id, rule.versionNumber, rule.status, rule.automationLevel, 'Imported from DAF workbook', rule.createdAt]
      );
      for (const variant of rule.variants) {
        await query(
          `insert into rule_variants
            (id, rule_version_id, runtime_rule_id, runtime_kind, execution_priority, enabled, is_executable,
             stop_processing, predicate_json, action_json, description, automation_level, status, source, created_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14::jsonb,$15)`,
          [
            variant.id,
            rule.versionId,
            variant.runtimeRuleId,
            variant.runtimeKind,
            variant.executionPriority,
            variant.enabled,
            variant.isExecutable,
            variant.stopProcessing,
            JSON.stringify(variant.predicateJson ?? null),
            JSON.stringify(variant.actionJson ?? null),
            variant.description,
            variant.automationLevel,
            variant.status,
            JSON.stringify(variant.source),
            rule.createdAt
          ]
        );
      }
    }
    await this.audit('rules.imported', 'rule_catalog', null, { ruleCount: rules.length });
  }

  async listRules(): Promise<RuleDefinition[]> {
    const definitionRows = await query<Record<string, unknown>>(
      `select d.*, v.id as version_id, v.version_number, v.status as version_status, v.automation_level as version_automation_level
       from rule_definitions d
       join rule_versions v on v.rule_definition_id = d.id
       order by d.rule_id`
    );
    const variantRows = await query<Record<string, unknown>>(
      `select rv.*, v.rule_definition_id, d.rule_id
       from rule_variants rv
       join rule_versions v on v.id = rv.rule_version_id
       join rule_definitions d on d.id = v.rule_definition_id
       order by rv.execution_priority`
    );
    return definitionRows.map((row) => dbRuleToDefinition(row, variantRows.filter((variant) => variant.rule_definition_id === row.id)));
  }

  async getRule(ruleId: string): Promise<RuleDefinition | null> {
    const rules = await this.listRules();
    return rules.find((rule) => rule.ruleId === ruleId) ?? null;
  }

  async createRun(run: RuleRun, results: RowExecutionResult[], rows: WorkflowRow[]): Promise<RuleRun> {
    await query(
      `insert into rule_runs
        (id, batch_id, status, run_mode, rule_version_snapshot, input_row_count, changed_row_count, review_row_count,
         error_message, started_at, completed_at)
       values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11)`,
      [
        run.id,
        run.batchId,
        run.status,
        run.runMode,
        JSON.stringify(run.ruleVersionSnapshot),
        run.inputRowCount,
        run.changedRowCount,
        run.reviewRowCount,
        run.errorMessage,
        run.startedAt,
        run.completedAt
      ]
    );
    for (const result of results) {
      await query(
        `insert into row_execution_results
          (id, run_id, workflow_row_id, before_state, after_state, trace, rules_applied, validations, created_at)
         values ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9)`,
        [
          result.id,
          result.runId,
          result.workflowRowId,
          JSON.stringify(result.beforeState),
          JSON.stringify(result.afterState),
          JSON.stringify(result.trace),
          JSON.stringify(result.rulesApplied),
          JSON.stringify(result.validations),
          result.createdAt
        ]
      );
    }
    await this.replaceRows(run.batchId, rows);
    await this.audit('rules.executed', 'rule_run', run.id, { batchId: run.batchId, changed: run.changedRowCount });
    return run;
  }

  async getRun(runId: string): Promise<RuleRun | null> {
    const rows = await query<Record<string, unknown>>(`select * from rule_runs where id = $1 limit 1`, [runId]);
    return rows[0] ? dbRunToRuleRun(rows[0]) : null;
  }

  async listRunResults(runId: string): Promise<RowExecutionResult[]> {
    const rows = await query<Record<string, unknown>>(`select * from row_execution_results where run_id = $1 order by created_at`, [runId]);
    return rows.map(dbResultToRowExecutionResult);
  }

  async audit(eventType: string, entityType: string, entityId: string | null, payload: unknown): Promise<void> {
    await query(
      `insert into audit_events (id, event_type, entity_type, entity_id, payload, created_at)
       values ($1,$2,$3,$4,$5::jsonb,now())`,
      [newId(), eventType, entityType, entityId, JSON.stringify(payload)]
    );
  }
}

async function insertWorkflowRows(rows: WorkflowRow[]): Promise<void> {
  for (const row of rows) {
    await query(
      `insert into workflow_rows
        (id, batch_id, source_row_number, workflow_request_key, raw_row, normalized_row, business, request_type,
         case_number, date_created, sector, division, unit_name, unit_number, vendor, din, min, manufacturer,
         brand, description, parent_category, sub_category, usage_qty, one_time_or_permanent, reason_for_request,
         dpl, meets_criteria, in_cat, on_mog, pantry, k12_apl, compass_apl, conversion_din, conversion_va_pct,
         upstream_action, upstream_if_in_stock_action, action, if_in_stock_action, buysmart_action, rule_applied,
         execution_trace, needs_review, analyst_notes, validation_status, excluded, excluded_reason, queue_bucket,
         request_bucket, outcome_reporting, selected, assignment, status, last_sync_at, last_saved_at, created_at, updated_at)
       values
        ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,
         $26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41::jsonb,$42,$43,$44,$45,$46,$47,$48,$49,$50,
         $51,$52,$53,$54,$55,$56)`,
      workflowRowParams(row)
    );
  }
}

async function updateWorkflowRow(row: WorkflowRow): Promise<void> {
  await query(
    `update workflow_rows set
      raw_row = $5::jsonb,
      normalized_row = $6::jsonb,
      business = $7,
      request_type = $8,
      case_number = $9,
      date_created = $10,
      sector = $11,
      division = $12,
      unit_name = $13,
      unit_number = $14,
      vendor = $15,
      din = $16,
      min = $17,
      manufacturer = $18,
      brand = $19,
      description = $20,
      parent_category = $21,
      sub_category = $22,
      usage_qty = $23,
      one_time_or_permanent = $24,
      reason_for_request = $25,
      dpl = $26,
      meets_criteria = $27,
      in_cat = $28,
      on_mog = $29,
      pantry = $30,
      k12_apl = $31,
      compass_apl = $32,
      conversion_din = $33,
      conversion_va_pct = $34,
      upstream_action = $35,
      upstream_if_in_stock_action = $36,
      action = $37,
      if_in_stock_action = $38,
      buysmart_action = $39,
      rule_applied = $40,
      execution_trace = $41::jsonb,
      needs_review = $42,
      analyst_notes = $43,
      validation_status = $44,
      excluded = $45,
      excluded_reason = $46,
      queue_bucket = $47,
      request_bucket = $48,
      outcome_reporting = $49,
      selected = $50,
      assignment = $51,
      status = $52,
      last_sync_at = $53,
      last_saved_at = $54,
      updated_at = $56
     where id = $1`,
    workflowRowParams(row)
  );
}

function workflowRowParams(row: WorkflowRow): unknown[] {
  return [
    row.id,
    row.batchId,
    row.sourceRowNumber,
    row.workflowRequestKey,
    JSON.stringify(row.rawRow),
    JSON.stringify(row.normalizedRow),
    row.business,
    row.requestType,
    row.caseNumber,
    row.dateCreated,
    row.sector,
    row.division,
    row.unitName,
    row.unitNumber,
    row.vendor,
    row.din,
    row.min,
    row.manufacturer,
    row.brand,
    row.description,
    row.parentCategory,
    row.subCategory,
    row.usageQty,
    row.oneTimeOrPermanent,
    row.reasonForRequest,
    row.dpl,
    row.meetsCriteria,
    row.inCat,
    row.onMog,
    row.pantry,
    row.k12Apl,
    row.compassApl,
    row.conversionDin,
    row.conversionVaPct,
    row.upstreamAction,
    row.upstreamIfInStockAction,
    row.action,
    row.ifInStockAction,
    row.buysmartAction,
    row.ruleApplied,
    JSON.stringify(row.executionTrace),
    row.needsReview,
    row.analystNotes,
    row.validationStatus,
    row.excluded,
    row.excludedReason,
    row.queueBucket,
    row.requestBucket,
    row.outcomeReporting,
    row.selected,
    row.assignment,
    row.status,
    row.lastSyncAt,
    row.lastSavedAt,
    row.createdAt,
    row.updatedAt
  ];
}

function dbBatchToSourceBatch(row: Record<string, unknown>): SourceBatch {
  return {
    id: String(row['id']),
    name: String(row['name']),
    sourceKind: String(row['source_kind']) as SourceBatch['sourceKind'],
    reportingDate: String(row['reporting_date']),
    status: String(row['status']),
    rowCount: Number(row['row_count']),
    sourceFileName: String(row['source_file_name']),
    sourceSheetName: String(row['source_sheet_name']),
    fileSha256: String(row['file_sha256']),
    createdAt: toIso(row['created_at']),
    updatedAt: toIso(row['updated_at'])
  };
}

function dbRowToWorkflowRow(row: Record<string, unknown>): WorkflowRow {
  return {
    id: String(row['id']),
    batchId: String(row['batch_id']),
    sourceRowNumber: Number(row['source_row_number']),
    workflowRequestKey: String(row['workflow_request_key']),
    rawRow: objectValue(row['raw_row']),
    normalizedRow: objectValue(row['normalized_row']) as WorkflowRow['normalizedRow'],
    business: textValue(row['business']),
    requestType: textValue(row['request_type']),
    caseNumber: textValue(row['case_number']),
    dateCreated: textValue(row['date_created']),
    sector: textValue(row['sector']),
    division: textValue(row['division']),
    unitName: textValue(row['unit_name']),
    unitNumber: textValue(row['unit_number']),
    vendor: textValue(row['vendor']),
    din: textValue(row['din']),
    min: textValue(row['min']),
    manufacturer: textValue(row['manufacturer']),
    brand: textValue(row['brand']),
    description: textValue(row['description']),
    parentCategory: textValue(row['parent_category']),
    subCategory: textValue(row['sub_category']),
    usageQty: nullableNumber(row['usage_qty']),
    oneTimeOrPermanent: textValue(row['one_time_or_permanent']),
    reasonForRequest: textValue(row['reason_for_request']),
    dpl: textValue(row['dpl']),
    meetsCriteria: nullableNumber(row['meets_criteria']),
    inCat: textValue(row['in_cat']),
    onMog: textValue(row['on_mog']),
    pantry: textValue(row['pantry']),
    k12Apl: textValue(row['k12_apl']),
    compassApl: textValue(row['compass_apl']),
    conversionDin: textValue(row['conversion_din']),
    conversionVaPct: nullableNumber(row['conversion_va_pct']),
    upstreamAction: textValue(row['upstream_action']),
    upstreamIfInStockAction: textValue(row['upstream_if_in_stock_action']),
    action: textValue(row['action']),
    ifInStockAction: textValue(row['if_in_stock_action']),
    buysmartAction: textValue(row['buysmart_action']),
    ruleApplied: textValue(row['rule_applied']),
    executionTrace: arrayValue(row['execution_trace']) as WorkflowRow['executionTrace'],
    needsReview: Boolean(row['needs_review']),
    analystNotes: textValue(row['analyst_notes']),
    validationStatus: textValue(row['validation_status']),
    excluded: Boolean(row['excluded']),
    excludedReason: textValue(row['excluded_reason']),
    queueBucket: textValue(row['queue_bucket']),
    requestBucket: textValue(row['request_bucket']),
    outcomeReporting: textValue(row['outcome_reporting']),
    selected: Boolean(row['selected']),
    assignment: textValue(row['assignment']),
    status: textValue(row['status']),
    lastSyncAt: textValue(row['last_sync_at']),
    lastSavedAt: textValue(row['last_saved_at']),
    createdAt: toIso(row['created_at']),
    updatedAt: toIso(row['updated_at'])
  };
}

function dbRuleToDefinition(row: Record<string, unknown>, variants: Record<string, unknown>[]): RuleDefinition {
  return {
    id: String(row['id']),
    ruleId: String(row['rule_id']),
    name: String(row['name']),
    ruleGroup: textValue(row['rule_group']),
    businessScope: textValue(row['business_scope']),
    requestTypes: arrayValue(row['request_types']).map(String),
    discoveryReference: textValue(row['discovery_reference']),
    notes: textValue(row['notes']),
    ownerTeam: textValue(row['owner_team']),
    versionId: String(row['version_id']),
    versionNumber: Number(row['version_number']),
    status: String(row['version_status']) as RuleDefinition['status'],
    automationLevel: String(row['version_automation_level']) as RuleDefinition['automationLevel'],
    variants: variants.map((variant) => ({
      id: String(variant['id']),
      ruleDefinitionId: String(row['id']),
      ruleVersionId: String(variant['rule_version_id']),
      ruleId: String(row['rule_id']),
      runtimeRuleId: String(variant['runtime_rule_id']),
      runtimeKind: String(variant['runtime_kind']) as RuleDefinition['variants'][number]['runtimeKind'],
      executionPriority: Number(variant['execution_priority']),
      enabled: Boolean(variant['enabled']),
      isExecutable: Boolean(variant['is_executable']),
      stopProcessing: Boolean(variant['stop_processing']),
      predicateJson: (variant['predicate_json'] ?? null) as RuleDefinition['variants'][number]['predicateJson'],
      actionJson: (variant['action_json'] ?? null) as RuleDefinition['variants'][number]['actionJson'],
      description: textValue(variant['description']),
      automationLevel: String(variant['automation_level']) as RuleDefinition['variants'][number]['automationLevel'],
      status: String(variant['status']) as RuleDefinition['variants'][number]['status'],
      source: objectValue(variant['source']) as RuleDefinition['variants'][number]['source']
    })),
    createdAt: toIso(row['created_at']),
    updatedAt: toIso(row['updated_at'])
  };
}

function dbRunToRuleRun(row: Record<string, unknown>): RuleRun {
  return {
    id: String(row['id']),
    batchId: String(row['batch_id']),
    status: String(row['status']) as RuleRun['status'],
    runMode: String(row['run_mode']) as RuleRun['runMode'],
    ruleVersionSnapshot: row['rule_version_snapshot'] as RuleRun['ruleVersionSnapshot'],
    inputRowCount: Number(row['input_row_count']),
    changedRowCount: Number(row['changed_row_count']),
    reviewRowCount: Number(row['review_row_count']),
    errorMessage: textValue(row['error_message']),
    startedAt: toIso(row['started_at']),
    completedAt: toIso(row['completed_at'])
  };
}

function dbResultToRowExecutionResult(row: Record<string, unknown>): RowExecutionResult {
  return {
    id: String(row['id']),
    runId: String(row['run_id']),
    workflowRowId: String(row['workflow_row_id']),
    beforeState: objectValue(row['before_state']) as WorkflowRow,
    afterState: objectValue(row['after_state']) as WorkflowRow,
    trace: arrayValue(row['trace']) as RowExecutionResult['trace'],
    rulesApplied: arrayValue(row['rules_applied']).map(String),
    validations: arrayValue(row['validations']).map(String),
    createdAt: toIso(row['created_at'])
  };
}

function textValue(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function objectValue(value: unknown): Record<string, JsonValue> {
  if (!value) return {};
  if (typeof value === 'string') return JSON.parse(value);
  return value as Record<string, JsonValue>;
}

function arrayValue(value: unknown): unknown[] {
  if (!value) return [];
  if (typeof value === 'string') return JSON.parse(value);
  return Array.isArray(value) ? value : [];
}

function toIso(value: unknown): string {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.valueOf()) ? String(value) : parsed.toISOString();
}
