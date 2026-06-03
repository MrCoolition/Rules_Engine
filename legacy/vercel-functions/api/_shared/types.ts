export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type Predicate =
  | { all: Predicate[] }
  | { any: Predicate[] }
  | { not: Predicate }
  | {
      field: string;
      op:
        | 'eq'
        | 'ne'
        | 'in'
        | 'not_in'
        | 'in_ref'
        | 'not_in_ref'
        | 'contains'
        | 'not_contains'
        | 'regex'
        | 'not_regex'
        | 'blank'
        | 'not_blank'
        | 'gt'
        | 'ge'
        | 'lt'
        | 'le'
        | 'is_true'
        | 'is_false';
      value?: JsonValue;
    };

export interface RuleAction {
  type:
    | 'set_action'
    | 'set_action_by_duration'
    | 'set_if_stock'
    | 'set_buysmart'
    | 'set_review'
    | 'append_validation'
    | 'add_note'
    | 'exclude'
    | 'clear_field'
    | 'copy_field'
    | 'preserve_action_set_if_stock';
  value?: JsonValue;
  reason?: string;
  field?: string;
  source?: string;
  target?: string;
  only_if_action_blank?: boolean;
  when?: Predicate;
}

export type AutomationLevel = 'alpha' | 'guided' | 'manual' | 'future';
export type RuleVersionStatus = 'draft' | 'ready' | 'approved' | 'disabled' | 'archived';

export interface CompiledRuleLogic {
  compilerVersion: string;
  fieldFilterLogic: string;
  aggregateLogic: string;
  predicateJson: Predicate | null;
  actionJson: RuleAction[] | null;
  executable: boolean;
  warnings: string[];
}

export interface DafLogicRow {
  ruleId: string;
  ruleGroup: string;
  business: string;
  requestTypes: string;
  decisionCriteria: string;
  action: string;
  ifInStockAction: string;
  buysmartAction: string;
  dailyActionFileColumns: string;
  setAction: string;
  downstreamHandling: string;
  discoveryReference: string;
  notes: string;
  sourceRowNumber: number;
  fieldFilterLogic?: string;
  aggregateLogic?: string;
  logic?: string;
  compiledLogic?: CompiledRuleLogic;
}

export interface RuleVariant {
  id: string;
  ruleDefinitionId: string;
  ruleVersionId: string;
  ruleId: string;
  runtimeRuleId: string;
  runtimeKind: 'row_rule' | 'validation_rule' | 'buysmart_rule' | 'downstream_rule';
  executionPriority: number;
  enabled: boolean;
  isExecutable: boolean;
  stopProcessing: boolean;
  predicateJson: Predicate | null;
  actionJson: RuleAction[] | null;
  description: string;
  automationLevel: AutomationLevel;
  status: RuleVersionStatus;
  source: DafLogicRow;
}

export interface RuleDefinition {
  id: string;
  ruleId: string;
  name: string;
  ruleGroup: string;
  businessScope: string;
  requestTypes: string[];
  discoveryReference: string;
  notes: string;
  ownerTeam: string;
  versionId: string;
  versionNumber: number;
  status: RuleVersionStatus;
  automationLevel: AutomationLevel;
  variants: RuleVariant[];
  createdAt: string;
  updatedAt: string;
}

export interface RuleImportReport {
  created: number;
  updated: number;
  unchanged: number;
  warnings: string[];
  duplicateRuleIds: string[];
  sheetNames: string[];
  executableVariants: number;
  guidedVariants: number;
  manualVariants: number;
}

export interface SourceBatch {
  id: string;
  name: string;
  sourceKind: 'upload' | 'warehouse' | 'sample';
  reportingDate: string;
  status: string;
  rowCount: number;
  sourceFileName: string;
  sourceSheetName: string;
  fileSha256: string;
  createdAt: string;
  updatedAt: string;
  summary?: BatchSummary;
}

export interface WorkflowRow {
  id: string;
  batchId: string;
  sourceRowNumber: number;
  workflowRequestKey: string;
  rawRow: Record<string, JsonValue>;
  normalizedRow: NormalizedRow;
  business: string;
  requestType: string;
  caseNumber: string;
  dateCreated: string;
  sector: string;
  division: string;
  unitName: string;
  unitNumber: string;
  vendor: string;
  din: string;
  min: string;
  manufacturer: string;
  brand: string;
  description: string;
  parentCategory: string;
  subCategory: string;
  usageQty: number | null;
  oneTimeOrPermanent: string;
  reasonForRequest: string;
  dpl: string;
  meetsCriteria: number | null;
  inCat: string;
  onMog: string;
  pantry: string;
  k12Apl: string;
  compassApl: string;
  conversionDin: string;
  conversionVaPct: number | null;
  upstreamAction: string;
  upstreamIfInStockAction: string;
  action: string;
  ifInStockAction: string;
  buysmartAction: string;
  ruleApplied: string;
  executionTrace: RuleTrace[];
  needsReview: boolean;
  analystNotes: string;
  validationStatus: string;
  excluded: boolean;
  excludedReason: string;
  queueBucket: string;
  requestBucket: string;
  outcomeReporting: string;
  selected: boolean;
  assignment: string;
  status: string;
  lastSyncAt: string;
  lastSavedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface NormalizedRow {
  source: Record<string, JsonValue>;
  fields: Record<string, JsonValue>;
  derived: Record<string, JsonValue>;
}

export interface RuleTrace {
  runtimeRuleId: string;
  ruleId: string;
  description: string;
  actionSummary: string;
  matchedAt: string;
  automationLevel: AutomationLevel;
}

export interface RuleRun {
  id: string;
  batchId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  runMode: 'full_batch' | 'selected_rows' | 'simulation';
  ruleVersionSnapshot: JsonValue;
  inputRowCount: number;
  changedRowCount: number;
  reviewRowCount: number;
  errorMessage: string;
  startedAt: string;
  completedAt: string;
}

export interface RowExecutionResult {
  id: string;
  runId: string;
  workflowRowId: string;
  beforeState: WorkflowRow;
  afterState: WorkflowRow;
  trace: RuleTrace[];
  rulesApplied: string[];
  validations: string[];
  createdAt: string;
}

export interface BatchSummary {
  rowCount: number;
  reviewCount: number;
  excludedCount: number;
  approvedCount: number;
  deniedCount: number;
  assignedCount: number;
  outcomeCounts: Record<string, number>;
  businessCounts: Record<string, number>;
  typeCounts: Record<string, number>;
  bucketSummaries: ComplianceBucketSummary[];
  automationCoveragePct: number;
}

export interface ComplianceBucketSummary {
  id: string;
  label: string;
  description: string;
  tone: 'good' | 'warn' | 'bad' | 'info' | 'dark';
  count: number;
  reviewCount: number;
  outcomeKeys: string[];
  ruleIds: string[];
  examples: {
    rowId: string;
    caseNumber: string;
    vendor: string;
    description: string;
    action: string;
    buysmartAction: string;
    outcomeReporting: string;
    ruleApplied: string;
  }[];
}

export interface ParsedSourceWorkbook {
  fileName: string;
  sheetName: string;
  columns: string[];
  rows: Record<string, JsonValue>[];
  warnings: string[];
  fileSha256: string;
}

export interface ParsedDafWorkbook {
  fileName: string;
  sheetNames: string[];
  logicRows: DafLogicRow[];
  requestTypes: Record<string, JsonValue>[];
  dailyActionFields: Record<string, JsonValue>[];
  actionValues: Record<string, JsonValue>[];
  evaluationOrder: Record<string, JsonValue>[];
  sources: Record<string, JsonValue>[];
  warnings: string[];
}

export interface PagedRows {
  rows: WorkflowRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface RouteManifest {
  frontendRoutes: { path: string; label: string; purpose: string }[];
  apiRoutes: { method: string; path: string; purpose: string }[];
}
