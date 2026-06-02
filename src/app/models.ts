export interface HealthResponse {
  ok: boolean;
  store: 'memory' | 'neon';
  databaseConfigured: boolean;
  defaultDafWorkbook: boolean;
  defaultSourceWorkbook: boolean;
  rulesSeeded?: boolean;
  ruleCount?: number;
  executableVariantCount?: number;
  timestamp: string;
}

export interface SourceBatch {
  id: string;
  name: string;
  sourceKind: string;
  reportingDate: string;
  status: string;
  rowCount: number;
  sourceFileName: string;
  sourceSheetName: string;
  createdAt: string;
  updatedAt: string;
  summary?: BatchSummary;
}

export interface WorkflowRow {
  id: string;
  batchId: string;
  sourceRowNumber: number;
  business: string;
  requestType: string;
  caseNumber: string;
  vendor: string;
  din: string;
  min: string;
  description: string;
  action: string;
  ifInStockAction: string;
  buysmartAction: string;
  ruleApplied: string;
  executionTrace: { runtimeRuleId: string; description: string; actionSummary: string }[];
  needsReview: boolean;
  analystNotes: string;
  validationStatus: string;
  excluded: boolean;
  excludedReason: string;
  queueBucket: string;
  outcomeReporting: string;
  status: string;
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

export interface RuleDefinition {
  id: string;
  ruleId: string;
  name: string;
  ruleGroup: string;
  businessScope: string;
  requestTypes: string[];
  notes?: string;
  status: string;
  automationLevel: string;
  variants: {
    runtimeRuleId: string;
    runtimeKind: string;
    enabled: boolean;
    isExecutable: boolean;
    stopProcessing?: boolean;
    status: string;
    automationLevel: string;
    description: string;
    predicateJson?: unknown;
    actionJson?: unknown;
    source?: {
      fieldFilterLogic?: string;
      aggregateLogic?: string;
      logic?: string;
      compiledLogic?: {
        compilerVersion?: string;
        fieldFilterLogic?: string;
        aggregateLogic?: string;
        executable?: boolean;
        warnings?: string[];
      };
    };
  }[];
}

export interface RuleCreateRequest {
  ruleId?: string;
  name: string;
  ruleGroup: string;
  businessScope: string;
  requestTypes: string;
  filter: {
    field: string;
    op: string;
    value: string | number | boolean;
  };
  actions: {
    action?: string;
    ifInStockAction?: string;
    buysmartAction?: string;
    review?: boolean;
    validation?: string;
    note?: string;
    exclude?: boolean;
    excludeReason?: string;
  };
  enabled: boolean;
  stopProcessing: boolean;
  notes?: string;
}

export interface RouteManifest {
  frontendRoutes: { path: string; label: string; purpose: string }[];
  apiRoutes: { method: string; path: string; purpose: string }[];
}

export interface RuleRun {
  id: string;
  batchId: string;
  status: string;
  runMode: string;
  inputRowCount: number;
  changedRowCount: number;
  reviewRowCount: number;
  startedAt: string;
  completedAt: string;
}
