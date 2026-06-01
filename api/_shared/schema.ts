import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid
} from 'drizzle-orm/pg-core';

export const sourceBatches = pgTable('source_batches', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  sourceKind: text('source_kind').notNull(),
  reportingDate: text('reporting_date').notNull(),
  status: text('status').notNull(),
  rowCount: integer('row_count').notNull(),
  sourceFileName: text('source_file_name').notNull(),
  sourceSheetName: text('source_sheet_name').notNull(),
  fileSha256: text('file_sha256').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
});

export const workflowRows = pgTable('workflow_rows', {
  id: uuid('id').primaryKey(),
  batchId: uuid('batch_id').notNull(),
  sourceRowNumber: integer('source_row_number').notNull(),
  workflowRequestKey: text('workflow_request_key').notNull(),
  rawRow: jsonb('raw_row').notNull(),
  normalizedRow: jsonb('normalized_row').notNull(),
  business: text('business'),
  requestType: text('request_type'),
  caseNumber: text('case_number'),
  dateCreated: text('date_created'),
  sector: text('sector'),
  division: text('division'),
  unitName: text('unit_name'),
  unitNumber: text('unit_number'),
  vendor: text('vendor'),
  din: text('din'),
  min: text('min'),
  manufacturer: text('manufacturer'),
  brand: text('brand'),
  description: text('description'),
  parentCategory: text('parent_category'),
  subCategory: text('sub_category'),
  usageQty: numeric('usage_qty'),
  oneTimeOrPermanent: text('one_time_or_permanent'),
  reasonForRequest: text('reason_for_request'),
  dpl: text('dpl'),
  meetsCriteria: numeric('meets_criteria'),
  inCat: text('in_cat'),
  onMog: text('on_mog'),
  pantry: text('pantry'),
  k12Apl: text('k12_apl'),
  compassApl: text('compass_apl'),
  conversionDin: text('conversion_din'),
  conversionVaPct: numeric('conversion_va_pct'),
  upstreamAction: text('upstream_action'),
  upstreamIfInStockAction: text('upstream_if_in_stock_action'),
  action: text('action'),
  ifInStockAction: text('if_in_stock_action'),
  buysmartAction: text('buysmart_action'),
  ruleApplied: text('rule_applied'),
  executionTrace: jsonb('execution_trace').notNull(),
  needsReview: boolean('needs_review').notNull(),
  analystNotes: text('analyst_notes'),
  validationStatus: text('validation_status'),
  excluded: boolean('excluded').notNull(),
  excludedReason: text('excluded_reason'),
  queueBucket: text('queue_bucket'),
  requestBucket: text('request_bucket'),
  outcomeReporting: text('outcome_reporting'),
  selected: boolean('selected').notNull(),
  assignment: text('assignment'),
  status: text('status').notNull(),
  lastSyncAt: text('last_sync_at'),
  lastSavedAt: text('last_saved_at'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
});

export const ruleDefinitions = pgTable('rule_definitions', {
  id: uuid('id').primaryKey(),
  ruleId: text('rule_id').notNull().unique(),
  name: text('name').notNull(),
  ruleGroup: text('rule_group'),
  businessScope: text('business_scope'),
  requestTypes: jsonb('request_types').notNull(),
  discoveryReference: text('discovery_reference'),
  notes: text('notes'),
  ownerTeam: text('owner_team'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
});

export const ruleVersions = pgTable('rule_versions', {
  id: uuid('id').primaryKey(),
  ruleDefinitionId: uuid('rule_definition_id').notNull(),
  versionNumber: integer('version_number').notNull(),
  status: text('status').notNull(),
  automationLevel: text('automation_level').notNull(),
  changeReason: text('change_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull()
});

export const ruleVariants = pgTable('rule_variants', {
  id: uuid('id').primaryKey(),
  ruleVersionId: uuid('rule_version_id').notNull(),
  runtimeRuleId: text('runtime_rule_id').notNull(),
  runtimeKind: text('runtime_kind').notNull(),
  executionPriority: integer('execution_priority').notNull(),
  enabled: boolean('enabled').notNull(),
  isExecutable: boolean('is_executable').notNull(),
  stopProcessing: boolean('stop_processing').notNull(),
  predicateJson: jsonb('predicate_json'),
  actionJson: jsonb('action_json'),
  description: text('description'),
  automationLevel: text('automation_level').notNull(),
  status: text('status').notNull(),
  source: jsonb('source').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull()
});

export const ruleRuns = pgTable('rule_runs', {
  id: uuid('id').primaryKey(),
  batchId: uuid('batch_id').notNull(),
  status: text('status').notNull(),
  runMode: text('run_mode').notNull(),
  ruleVersionSnapshot: jsonb('rule_version_snapshot').notNull(),
  inputRowCount: integer('input_row_count').notNull(),
  changedRowCount: integer('changed_row_count').notNull(),
  reviewRowCount: integer('review_row_count').notNull(),
  errorMessage: text('error_message'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true })
});

export const rowExecutionResults = pgTable('row_execution_results', {
  id: uuid('id').primaryKey(),
  runId: uuid('run_id').notNull(),
  workflowRowId: uuid('workflow_row_id').notNull(),
  beforeState: jsonb('before_state').notNull(),
  afterState: jsonb('after_state').notNull(),
  trace: jsonb('trace').notNull(),
  rulesApplied: jsonb('rules_applied').notNull(),
  validations: jsonb('validations').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull()
});

export const analystOverrides = pgTable('analyst_overrides', {
  id: uuid('id').primaryKey(),
  workflowRowId: uuid('workflow_row_id').notNull(),
  fieldName: text('field_name').notNull(),
  oldValue: text('old_value'),
  newValue: text('new_value'),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull()
});

export const auditEvents = pgTable('audit_events', {
  id: uuid('id').primaryKey(),
  actorId: uuid('actor_id'),
  eventType: text('event_type').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id'),
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull()
});
