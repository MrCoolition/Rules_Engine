import crypto from 'node:crypto';
import type {
  AutomationLevel,
  BatchSummary,
  DafLogicRow,
  JsonValue,
  NormalizedRow,
  ParsedDafWorkbook,
  Predicate,
  RuleAction,
  RuleDefinition,
  RuleImportReport,
  RuleTrace,
  RuleVariant,
  RuleVersionStatus,
  WorkflowRow
} from './types.js';
import {
  cleanText,
  createNormalizedRow,
  normalizeAction,
  normalizeKey,
  queueBucketForType,
  REFERENCE_LISTS,
  rowToSearchText
} from './normalize.js';

interface ExecutableSpec {
  predicate: Predicate;
  actions: RuleAction[];
  stopProcessing?: boolean;
  runtimeKind?: RuleVariant['runtimeKind'];
}

interface ExecuteRowsResult {
  rows: WorkflowRow[];
  changedCount: number;
  reviewCount: number;
}

export function buildRuleCatalog(parsed: ParsedDafWorkbook): {
  rules: RuleDefinition[];
  report: RuleImportReport;
} {
  const now = new Date().toISOString();
  const grouped = new Map<string, DafLogicRow[]>();
  const seen = new Map<string, number>();

  for (const logicRow of parsed.logicRows) {
    grouped.set(logicRow.ruleId, [...(grouped.get(logicRow.ruleId) ?? []), logicRow]);
    seen.set(logicRow.ruleId, (seen.get(logicRow.ruleId) ?? 0) + 1);
  }

  const duplicateRuleIds = [...seen.entries()].filter(([, count]) => count > 1).map(([ruleId]) => ruleId);
  const rules: RuleDefinition[] = [];
  let executableVariants = 0;
  let guidedVariants = 0;
  let manualVariants = 0;

  [...grouped.entries()]
    .sort(([a], [b]) => ruleNumber(a) - ruleNumber(b))
    .forEach(([ruleId, rows]) => {
      const first = rows[0];
      const definitionId = stableId(`definition:${ruleId}`);
      const versionId = stableId(`version:${ruleId}:1`);
      const variants: RuleVariant[] = rows.map((row, index) => {
        const spec = executableSpecFor(row);
        const automationLevel = automationLevelFor(row, spec);
        const status = statusFor(automationLevel);
        if (automationLevel === 'alpha') executableVariants += 1;
        if (automationLevel === 'guided') guidedVariants += 1;
        if (automationLevel === 'manual' || automationLevel === 'future') manualVariants += 1;

        return {
          id: stableId(`variant:${ruleId}:${index + 1}:${row.sourceRowNumber}`),
          ruleDefinitionId: definitionId,
          ruleVersionId: versionId,
          ruleId,
          runtimeRuleId: `${ruleId}.${String(index + 1).padStart(2, '0')}`,
          runtimeKind: spec?.runtimeKind ?? runtimeKindFor(row),
          executionPriority: ruleNumber(ruleId) * 100 + index,
          enabled: status === 'approved' || status === 'ready',
          isExecutable: Boolean(spec),
          stopProcessing: Boolean(spec?.stopProcessing),
          predicateJson: spec?.predicate ?? null,
          actionJson: spec?.actions ?? null,
          description: row.decisionCriteria || row.setAction || row.ruleGroup,
          automationLevel,
          status,
          source: row
        };
      });

      const automationLevel = aggregateAutomation(variants);
      rules.push({
        id: definitionId,
        ruleId,
        name: `${first.ruleGroup || 'Rule'} ${ruleId}`,
        ruleGroup: first.ruleGroup,
        businessScope: first.business,
        requestTypes: splitList(first.requestTypes),
        discoveryReference: first.discoveryReference,
        notes: rows.map((row) => row.notes).filter(Boolean).join(' | '),
        ownerTeam: 'Compliance Operations',
        versionId,
        versionNumber: 1,
        status: variants.some((variant) => variant.status === 'approved') ? 'approved' : 'ready',
        automationLevel,
        variants,
        createdAt: now,
        updatedAt: now
      });
    });

  return {
    rules,
    report: {
      created: rules.length,
      updated: 0,
      unchanged: 0,
      warnings: parsed.warnings,
      duplicateRuleIds,
      sheetNames: parsed.sheetNames,
      executableVariants,
      guidedVariants,
      manualVariants
    }
  };
}

export function executeRows(inputRows: WorkflowRow[], rules: RuleDefinition[], rowIds?: string[]): ExecuteRowsResult {
  const executableVariants = rules
    .flatMap((rule) => rule.variants)
    .filter((variant) => variant.enabled && variant.isExecutable && variant.status === 'approved')
    .sort((a, b) => a.executionPriority - b.executionPriority);
  const selectedIds = rowIds?.length ? new Set(rowIds) : null;
  let changedCount = 0;
  let reviewCount = 0;

  const rows = inputRows.map((row) => {
    if (selectedIds && !selectedIds.has(row.id)) return row;
    const before = JSON.stringify(projectDecisionFields(row));
    const executed = executeRow(row, executableVariants);
    const after = JSON.stringify(projectDecisionFields(executed));
    if (before !== after) changedCount += 1;
    if (executed.needsReview) reviewCount += 1;
    return executed;
  });

  return { rows, changedCount, reviewCount };
}

export function executeRow(input: WorkflowRow, variants: RuleVariant[]): WorkflowRow {
  const now = new Date().toISOString();
  let row = refreshDerived({ ...input, executionTrace: [], ruleApplied: '' });

  if (variants.length === 0) {
    row.needsReview = true;
    row.validationStatus = appendText(row.validationStatus, 'Executable rule catalog missing');
    row.queueBucket = 'Rule Catalog Review';
    row.outcomeReporting = classifyOutcome(row);
    row.updatedAt = now;
    return row;
  }

  for (const variant of variants) {
    const context = contextForRow(row);
    if (!variant.predicateJson || !evaluatePredicate(variant.predicateJson, context)) continue;
    row = applyActions(row, variant.actionJson ?? [], variant);
    row.executionTrace = [
      ...row.executionTrace,
      {
        runtimeRuleId: variant.runtimeRuleId,
        ruleId: variant.ruleId,
        description: variant.description,
        actionSummary: summarizeActions(variant.actionJson ?? []),
        matchedAt: now,
        automationLevel: variant.automationLevel
      }
    ];
    row.ruleApplied = appendText(row.ruleApplied, variant.runtimeRuleId);
    row = refreshDerived(row);
    if (variant.stopProcessing) break;
  }

  if (!row.buysmartAction && !row.excluded) {
    row.buysmartAction = row.needsReview ? 'Review' : 'Assigned';
  }
  row.status = row.excluded ? 'Excluded' : row.needsReview ? 'Review' : 'Ready';
  row.outcomeReporting = classifyOutcome(row);
  row.updatedAt = now;
  return row;
}

export function applyRowPatch(row: WorkflowRow, patch: Record<string, unknown>): WorkflowRow {
  const editable = new Set([
    'action',
    'ifInStockAction',
    'buysmartAction',
    'needsReview',
    'analystNotes',
    'assignment',
    'status',
    'selected',
    'validationStatus'
  ]);
  const next: WorkflowRow = { ...row };
  for (const [key, value] of Object.entries(patch)) {
    if (!editable.has(key)) continue;
    (next as unknown as Record<string, unknown>)[key] = typeof value === 'string' ? normalizeAction(value) : value;
  }
  next.lastSavedAt = new Date().toISOString();
  next.updatedAt = next.lastSavedAt;
  next.outcomeReporting = classifyOutcome(next);
  return refreshDerived(next);
}

export function filterRows(rows: WorkflowRow[], query: URLSearchParams): { rows: WorkflowRow[]; total: number; page: number; pageSize: number } {
  const page = Math.max(Number(query.get('page') ?? '1') || 1, 1);
  const pageSize = Math.min(Math.max(Number(query.get('pageSize') ?? '50') || 50, 1), 250);
  const search = cleanText(query.get('search')).toLowerCase();
  const business = cleanText(query.get('business'));
  const type = cleanText(query.get('type'));
  const status = cleanText(query.get('status'));
  const buysmartAction = cleanText(query.get('buysmartAction'));
  const outcome = cleanText(query.get('outcome'));
  const needsReview = query.get('needsReview');
  const excluded = query.get('excluded');

  const filtered = rows.filter((row) => {
    if (search && !rowToSearchText(row).includes(search)) return false;
    if (business && row.business !== business) return false;
    if (type && row.requestType !== type) return false;
    if (status && row.status !== status) return false;
    if (buysmartAction && row.buysmartAction !== buysmartAction) return false;
    if (outcome && row.outcomeReporting !== outcome) return false;
    if (needsReview !== null && String(row.needsReview) !== needsReview) return false;
    if (excluded !== null && String(row.excluded) !== excluded) return false;
    return true;
  });

  const start = (page - 1) * pageSize;
  return {
    rows: filtered.slice(start, start + pageSize),
    total: filtered.length,
    page,
    pageSize
  };
}

export function summarizeBatch(rows: WorkflowRow[]): BatchSummary {
  const rowCount = rows.length;
  const outcomeCounts = countBy(rows, (row) => row.outcomeReporting || 'assigned');
  const businessCounts = countBy(rows, (row) => row.business || 'Unknown');
  const typeCounts = countBy(rows, (row) => row.requestType || 'Unknown');
  const withTrace = rows.filter((row) => row.executionTrace.length > 0).length;
  return {
    rowCount,
    reviewCount: rows.filter((row) => row.needsReview).length,
    excludedCount: rows.filter((row) => row.excluded).length,
    approvedCount: (outcomeCounts['approved'] ?? 0) + (outcomeCounts['1x approved'] ?? 0),
    deniedCount: outcomeCounts['denied'] ?? 0,
    assignedCount: outcomeCounts['assigned'] ?? 0,
    outcomeCounts,
    businessCounts,
    typeCounts,
    automationCoveragePct: rowCount ? Math.round((withTrace / rowCount) * 1000) / 10 : 0
  };
}

export function classifyOutcome(row: WorkflowRow): string {
  const action = `${row.action} ${row.buysmartAction}`.toLowerCase();
  if (row.excluded) return 'excluded';
  if (row.buysmartAction.toLowerCase() === 'denied' || normalizeKey(row.action) === 'NO') return 'denied';
  if (action.includes('use right')) return 'use right';
  if (action.includes('find alt')) return 'find alt first';
  if (action.includes('cdm')) return 'send/check with CDM';
  if (row.buysmartAction.toLowerCase() === 'approved' && /one-time|one time/i.test(row.oneTimeOrPermanent)) return '1x approved';
  if (row.buysmartAction.toLowerCase() === 'approved') return 'approved';
  if (normalizeKey(row.action) === '1X' || action.includes('approved - 1x')) return '1x approved';
  if (row.needsReview) return 'unresolved exceptions';
  return 'assigned';
}

export function catalogSnapshot(rules: RuleDefinition[]): JsonValue {
  return rules.map((rule) => ({
    ruleId: rule.ruleId,
    version: rule.versionNumber,
    status: rule.status,
    variants: rule.variants.map((variant) => ({
      runtimeRuleId: variant.runtimeRuleId,
      executable: variant.isExecutable,
      status: variant.status
    }))
  })) as JsonValue;
}

function executableSpecFor(row: DafLogicRow): ExecutableSpec | null {
  const ruleId = row.ruleId;
  const criteria = row.decisionCriteria.toLowerCase();
  const business = row.business.toLowerCase();
  const requestTypes = row.requestTypes.toLowerCase();

  switch (ruleId) {
    case 'R001':
      return {
        predicate: { field: 'vendor_lc', op: 'in_ref', value: 'local_vendors' },
        actions: [
          { type: 'exclude', reason: 'Local/vendor exclusion from DAF R001' },
          { type: 'add_note', value: 'Removed from managed workflow by vendor exclusion.' }
        ],
        stopProcessing: true,
        runtimeKind: 'validation_rule'
      };
    case 'R002':
      return {
        predicate: { any: [{ field: 'min_lc', op: 'blank' }, { field: 'din_lc', op: 'blank' }] },
        actions: [
          { type: 'set_action', value: 'Invalid Information' },
          { type: 'append_validation', value: 'Missing MIN or DIN' },
          { type: 'set_review', value: true },
          { type: 'set_buysmart', value: 'Review' }
        ],
        stopProcessing: true,
        runtimeKind: 'validation_rule'
      };
    case 'R004':
      return {
        predicate: { field: 'is_hmshost', op: 'is_true' },
        actions: [
          { type: 'set_action', value: 'Review' },
          { type: 'set_buysmart', value: 'Assigned' },
          { type: 'set_review', value: true },
          { type: 'add_note', value: 'Route as HMSHost.' }
        ]
      };
    case 'R005':
      return {
        predicate: { all: [{ field: 'is_canada', op: 'is_true' }, { field: 'is_mass_add', op: 'is_true' }] },
        actions: [
          { type: 'set_buysmart', value: 'Assigned' },
          { type: 'set_review', value: true },
          { type: 'add_note', value: 'Canada mass add requires APL/Pantry confirmation.' }
        ]
      };
    case 'R006':
      return {
        predicate: {
          all: [
            { field: 'is_canada', op: 'is_true' },
            { field: 'is_prf', op: 'is_true' },
            { any: [{ field: 'is_s1', op: 'is_true' }, { field: 'is_pantry', op: 'is_true' }] }
          ]
        },
        actions: [
          { type: 'preserve_action_set_if_stock', value: row.action.includes('Cannot') ? 'OK' : '' },
          { type: 'set_action', value: row.action || 'OK', only_if_action_blank: true },
          { type: 'set_buysmart', value: 'Assigned' }
        ]
      };
    case 'R007':
      return {
        predicate: {
          all: [
            { field: 'is_canada', op: 'is_true' },
            { any: [{ field: 'is_prf', op: 'is_true' }, { field: 'is_sorf', op: 'is_true' }, { field: 'is_srf', op: 'is_true' }] },
            { field: 'is_one_time', op: 'is_true' },
            { field: 'usage_num', op: 'le', value: 10 },
            notPreferredPredicate()
          ]
        },
        actions: [
          { type: 'set_action', value: '1X' },
          { type: 'set_if_stock', value: 'OK' },
          { type: 'set_buysmart', value: 'Assigned' }
        ]
      };
    case 'R008':
      return {
        predicate: {
          all: [
            { field: 'is_canada', op: 'is_true' },
            { field: 'is_one_time', op: 'is_true' },
            { field: 'usage_num', op: 'gt', value: 10 },
            notPreferredPredicate()
          ]
        },
        actions: [
          { type: 'set_buysmart', value: 'Review' },
          { type: 'set_review', value: true },
          { type: 'add_note', value: 'Canada one-time usage above 10 requires escalation.' }
        ]
      };
    case 'R011':
      return {
        predicate: { all: [{ field: 'is_healthtrust', op: 'is_true' }, { field: 'is_prf', op: 'is_true' }, { field: 'has_conversion', op: 'is_true' }] },
        actions: [
          { type: 'set_action', value: 'Use Right' },
          { type: 'set_buysmart', value: 'Assigned' }
        ]
      };
    case 'R012':
      if (criteria.includes('is not') || criteria.includes('does not')) {
        return {
          predicate: { all: [{ field: 'is_healthtrust', op: 'is_true' }, notPreferredPredicate()] },
          actions: [
            { type: 'set_action', value: 'Review' },
            { type: 'set_buysmart', value: 'Assigned' },
            { type: 'set_review', value: true }
          ]
        };
      }
      return {
        predicate: {
          all: [
            { field: 'is_healthtrust', op: 'is_true' },
            { any: [{ field: 'is_prf', op: 'is_true' }, { field: 'is_sorf', op: 'is_true' }] },
            preferredPredicate()
          ]
        },
        actions: [
          { type: 'set_action_by_duration' },
          { type: 'set_buysmart', value: row.buysmartAction || 'Assigned' }
        ]
      };
    case 'R014':
      if (business.includes('healthtrust')) {
        return {
          predicate: {
            all: [
              { field: 'is_healthtrust', op: 'is_true' },
              { field: 'is_sorf', op: 'is_true' },
              { field: 'has_conversion', op: 'is_true' },
              { field: 'usage_num', op: 'lt', value: 10 }
            ]
          },
          actions: [
            { type: 'set_action', value: 'Use Right' },
            { type: 'set_buysmart', value: 'Review' },
            { type: 'set_review', value: true }
          ]
        };
      }
      return {
        predicate: { all: [{ field: 'is_compass', op: 'is_true' }, { field: 'is_srf', op: 'is_true' }, { field: 'has_conversion', op: 'is_true' }] },
        actions: [
          { type: 'set_action', value: 'Use Right' },
          { type: 'set_buysmart', value: 'Assigned' }
        ]
      };
    case 'R016':
      return {
        predicate: {
          all: [
            { field: 'is_compass', op: 'is_true' },
            { any: [{ field: 'reason_lc', op: 'contains', value: 'sponsorship' }, { field: 'reason_lc', op: 'contains', value: 'menucycle' }] }
          ]
        },
        actions: [
          { type: 'set_action_by_duration' },
          { type: 'set_buysmart', value: 'Assigned' }
        ]
      };
    case 'R023':
      return {
        predicate: {
          all: [
            { field: 'is_compass', op: 'is_true' },
            { any: [{ field: 'is_prf', op: 'is_true' }, { field: 'is_sorf', op: 'is_true' }] },
            { any: [{ field: 'is_s1', op: 'is_true' }, { field: 'is_foh', op: 'is_true' }, { field: 'is_diverse', op: 'is_true' }, { field: 'is_core_apl', op: 'is_true' }] }
          ]
        },
        actions: [
          { type: 'set_action_by_duration' },
          { type: 'preserve_action_set_if_stock', value: 'OK' }
        ]
      };
    case 'R024':
      return {
        predicate: { all: [{ field: 'is_compass', op: 'is_true' }, { field: 'is_schools', op: 'is_true' }, { field: 'is_k12_apl', op: 'is_true' }] },
        actions: [{ type: 'set_action_by_duration' }]
      };
    case 'R025':
      return {
        predicate: { field: 'is_pantry', op: 'is_true' },
        actions: [{ type: 'set_action_by_duration' }]
      };
    case 'R026':
      return {
        predicate: { field: 'meets_criteria_ge_10', op: 'is_true' },
        actions: [{ type: 'set_action_by_duration' }]
      };
    case 'R027':
      return {
        predicate: {
          any: [
            { field: 'reason_lc', op: 'contains', value: 'sponsorship' },
            { field: 'reason_lc', op: 'contains', value: 'commodity' },
            { field: 'reason_lc', op: 'contains', value: 'allocation' }
          ]
        },
        actions: [{ type: 'set_action_by_duration' }]
      };
    case 'R028':
      return {
        predicate: { field: 'description_lc', op: 'regex', value: 'halal|gluten free|sugar free|vegan|kosher|\\bgf\\b|puree|nutritional' },
        actions: [{ type: 'set_action_by_duration' }]
      };
    case 'R036':
      return {
        predicate: { all: [{ field: 'is_one_time', op: 'is_true' }, { field: 'usage_num', op: 'lt', value: 15 }] },
        actions: [
          { type: 'set_action', value: '1X', only_if_action_blank: true },
          { type: 'set_buysmart', value: 'Assigned' }
        ]
      };
    case 'R041':
      return {
        predicate: {
          all: [
            { field: 'is_compass', op: 'is_true' },
            { field: 'is_prf', op: 'is_true' },
            { field: 'is_permanent', op: 'is_true' },
            { any: [{ field: 'current_action_key', op: 'eq', value: 'OK' }, { field: 'current_action_key', op: 'contains', value: 'ON MOG' }] },
            { field: 'is_in_cat_y', op: 'is_true' },
            { field: 'din_lc', op: 'not_contains', value: 'new' }
          ]
        },
        actions: [{ type: 'set_buysmart', value: 'Approved' }],
        runtimeKind: 'buysmart_rule'
      };
    case 'R042':
      return {
        predicate: {
          all: [
            { any: [{ field: 'is_in_cat_y', op: 'is_false' }, { field: 'is_temp_available', op: 'is_true' }] },
            { field: 'current_action_key', op: 'contains', value: 'CANNOT ADD' }
          ]
        },
        actions: [{ type: 'set_buysmart', value: 'Denied' }],
        runtimeKind: 'buysmart_rule'
      };
    case 'R043':
      return {
        predicate: { any: [{ field: 'is_mass_add', op: 'is_true' }, { field: 'is_mass_srf', op: 'is_true' }] },
        actions: [{ type: 'set_buysmart', value: 'Assigned' }],
        runtimeKind: 'buysmart_rule'
      };
    case 'R044':
      return {
        predicate: { field: 'current_buysmart_key', op: 'blank' },
        actions: [{ type: 'set_buysmart', value: 'Assigned' }],
        runtimeKind: 'buysmart_rule'
      };
    case 'R047':
      return {
        predicate: { all: [{ field: 'is_prf', op: 'is_true' }, { field: 'current_action_key', op: 'eq', value: '1X' }] },
        actions: [{ type: 'set_buysmart', value: 'Approved' }],
        runtimeKind: 'downstream_rule'
      };
    case 'R048':
      return {
        predicate: { all: [{ field: 'is_prf', op: 'is_true' }, { field: 'current_action_key', op: 'contains', value: 'ON MOG' }] },
        actions: [{ type: 'set_buysmart', value: 'Approved' }],
        runtimeKind: 'downstream_rule'
      };
    default:
      if (requestTypes.includes('approved rows')) {
        return {
          predicate: { field: 'current_buysmart_key', op: 'eq', value: 'APPROVED' },
          actions: [{ type: 'add_note', value: row.downstreamHandling || row.setAction }],
          runtimeKind: 'downstream_rule'
        };
      }
      return null;
  }
}

function preferredPredicate(): Predicate {
  return {
    any: [
      { field: 'is_s1', op: 'is_true' },
      { field: 'is_foh', op: 'is_true' },
      { field: 'is_diverse', op: 'is_true' },
      { field: 'is_core_apl', op: 'is_true' },
      { field: 'is_pantry', op: 'is_true' },
      { field: 'meets_criteria_ge_10', op: 'is_true' }
    ]
  };
}

function notPreferredPredicate(): Predicate {
  return { not: preferredPredicate() };
}

function evaluatePredicate(predicate: Predicate, context: Record<string, JsonValue>): boolean {
  if ('all' in predicate) return predicate.all.every((child) => evaluatePredicate(child, context));
  if ('any' in predicate) return predicate.any.some((child) => evaluatePredicate(child, context));
  if ('not' in predicate) return !evaluatePredicate(predicate.not, context);

  const fieldValue = context[predicate.field];
  const op = predicate.op;
  const target = predicate.value;
  const leftText = cleanText(fieldValue);
  const rightText = cleanText(target);
  const leftKey = normalizeKey(fieldValue);
  const rightKey = normalizeKey(target);

  switch (op) {
    case 'eq':
      return leftKey === rightKey;
    case 'ne':
      return leftKey !== rightKey;
    case 'in':
      return Array.isArray(target) && target.map(normalizeKey).includes(leftKey);
    case 'not_in':
      return Array.isArray(target) && !target.map(normalizeKey).includes(leftKey);
    case 'in_ref': {
      const list = REFERENCE_LISTS[String(target ?? '')] ?? [];
      return list.some((item) => leftText.toLowerCase().includes(item.toLowerCase()));
    }
    case 'not_in_ref': {
      const list = REFERENCE_LISTS[String(target ?? '')] ?? [];
      return !list.some((item) => leftText.toLowerCase().includes(item.toLowerCase()));
    }
    case 'contains':
      return leftKey.includes(rightKey);
    case 'not_contains':
      return !leftKey.includes(rightKey);
    case 'regex':
      return new RegExp(rightText, 'i').test(leftText);
    case 'not_regex':
      return !new RegExp(rightText, 'i').test(leftText);
    case 'blank':
      return leftText === '';
    case 'not_blank':
      return leftText !== '';
    case 'gt':
    case 'ge':
    case 'lt':
    case 'le': {
      const leftNumber = Number(fieldValue);
      const rightNumber = Number(target);
      if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) return false;
      if (op === 'gt') return leftNumber > rightNumber;
      if (op === 'ge') return leftNumber >= rightNumber;
      if (op === 'lt') return leftNumber < rightNumber;
      return leftNumber <= rightNumber;
    }
    case 'is_true':
      return fieldValue === true;
    case 'is_false':
      return fieldValue === false;
    default:
      return false;
  }
}

function applyActions(row: WorkflowRow, actions: RuleAction[], variant: RuleVariant): WorkflowRow {
  let next = { ...row };
  for (const action of actions) {
    const context = contextForRow(next);
    if (action.when && !evaluatePredicate(action.when, context)) continue;
    if (action.only_if_action_blank && next.action) continue;

    switch (action.type) {
      case 'set_action':
        next.action = normalizeAction(action.value);
        break;
      case 'set_action_by_duration':
        next.action = next.oneTimeOrPermanent.toLowerCase().includes('one') || next.oneTimeOrPermanent.toLowerCase().includes('seasonal') ? '1X' : 'OK';
        break;
      case 'set_if_stock':
        next.ifInStockAction = normalizeAction(action.value);
        break;
      case 'set_buysmart':
        next.buysmartAction = normalizeAction(action.value);
        break;
      case 'set_review':
        next.needsReview = Boolean(action.value);
        break;
      case 'append_validation':
        next.validationStatus = appendText(next.validationStatus, cleanText(action.value));
        break;
      case 'add_note':
        next.analystNotes = appendText(next.analystNotes, cleanText(action.value));
        break;
      case 'exclude':
        next.excluded = true;
        next.excludedReason = action.reason || variant.description;
        next.needsReview = false;
        next.buysmartAction = '';
        break;
      case 'clear_field':
        if (action.field === 'Conversion DIN') next.conversionDin = '';
        break;
      case 'copy_field':
        if (action.source && action.target) {
          const record = next as unknown as Record<string, string>;
          record[action.target] = record[action.source] ?? '';
        }
        break;
      case 'preserve_action_set_if_stock':
        if (next.upstreamAction && /on mog|cannot add/i.test(next.upstreamAction) && cleanText(action.value)) {
          next.action = next.upstreamAction;
          next.ifInStockAction = normalizeAction(action.value);
        }
        break;
      default:
        break;
    }
  }
  return next;
}

function contextForRow(row: WorkflowRow): Record<string, JsonValue> {
  const base = {
    ...row.normalizedRow.fields,
    ...row.normalizedRow.derived,
    current_action_key: normalizeKey(row.action),
    current_buysmart_key: normalizeKey(row.buysmartAction),
    action: row.action,
    buysmartAction: row.buysmartAction
  };
  return base as Record<string, JsonValue>;
}

function refreshDerived(row: WorkflowRow): WorkflowRow {
  const source = {
    ...row.rawRow,
    ACTION: row.upstreamAction,
    'If In Stock: Action': row.upstreamIfInStockAction,
    'Buysmart Action': row.buysmartAction
  };
  const normalized: NormalizedRow = createNormalizedRow(source);
  normalized.derived['current_action_key'] = normalizeKey(row.action);
  normalized.derived['current_buysmart_key'] = normalizeKey(row.buysmartAction);
  row.normalizedRow = normalized;
  row.queueBucket = row.queueBucket || queueBucketForType(row.requestType);
  return row;
}

function summarizeActions(actions: RuleAction[]): string {
  return actions
    .map((action) => {
      if (action.type === 'exclude') return `exclude: ${action.reason ?? ''}`;
      if (action.value !== undefined) return `${action.type}: ${cleanText(action.value)}`;
      return action.type;
    })
    .join(', ');
}

function automationLevelFor(row: DafLogicRow, spec: ExecutableSpec | null): AutomationLevel {
  if (spec) return 'alpha';
  const text = `${row.decisionCriteria} ${row.setAction} ${row.downstreamHandling} ${row.notes}`.toLowerCase();
  if (text.includes('external') || text.includes('matrix') || text.includes('judgment') || text.includes('follow up')) return 'manual';
  if (text.includes('manual') || text.includes('review') || text.includes('specialist')) return 'guided';
  return 'future';
}

function statusFor(level: AutomationLevel): RuleVersionStatus {
  if (level === 'alpha') return 'approved';
  if (level === 'guided') return 'ready';
  return 'draft';
}

function aggregateAutomation(variants: RuleVariant[]): AutomationLevel {
  if (variants.every((variant) => variant.automationLevel === 'alpha')) return 'alpha';
  if (variants.some((variant) => variant.automationLevel === 'alpha' || variant.automationLevel === 'guided')) return 'guided';
  if (variants.some((variant) => variant.automationLevel === 'manual')) return 'manual';
  return 'future';
}

function runtimeKindFor(row: DafLogicRow): RuleVariant['runtimeKind'] {
  const group = row.ruleGroup.toLowerCase();
  if (group.includes('closeout')) return 'buysmart_rule';
  if (group.includes('upload') || group.includes('splitting')) return 'downstream_rule';
  if (group.includes('pre-processing')) return 'validation_rule';
  return 'row_rule';
}

function ruleNumber(ruleId: string): number {
  const match = /R(\d+)/i.exec(ruleId);
  return match ? Number(match[1]) : 9999;
}

function splitList(text: string): string[] {
  return text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function stableId(input: string): string {
  const hash = crypto.createHash('sha256').update(input).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

function appendText(existing: string, addition: string): string {
  if (!addition) return existing;
  if (!existing) return addition;
  if (existing.includes(addition)) return existing;
  return `${existing}; ${addition}`;
}

function projectDecisionFields(row: WorkflowRow): Record<string, unknown> {
  return {
    action: row.action,
    ifInStockAction: row.ifInStockAction,
    buysmartAction: row.buysmartAction,
    ruleApplied: row.ruleApplied,
    needsReview: row.needsReview,
    validationStatus: row.validationStatus,
    excluded: row.excluded,
    excludedReason: row.excludedReason,
    outcomeReporting: row.outcomeReporting
  };
}

function countBy(rows: WorkflowRow[], selector: (row: WorkflowRow) => string): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const key = selector(row);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}
