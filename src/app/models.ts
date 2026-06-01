export interface HealthResponse {
  ok: boolean;
  store: 'memory' | 'neon';
  databaseConfigured: boolean;
  defaultDafWorkbook: boolean;
  defaultSourceWorkbook: boolean;
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
  automationCoveragePct: number;
}

export interface RuleDefinition {
  id: string;
  ruleId: string;
  name: string;
  ruleGroup: string;
  businessScope: string;
  requestTypes: string[];
  status: string;
  automationLevel: string;
  variants: {
    runtimeRuleId: string;
    runtimeKind: string;
    enabled: boolean;
    isExecutable: boolean;
    status: string;
    automationLevel: string;
    description: string;
  }[];
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
