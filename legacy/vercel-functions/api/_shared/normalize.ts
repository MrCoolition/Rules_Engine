import type { JsonValue, NormalizedRow, WorkflowRow } from './types.js';

const HEADER_ALIASES: Record<string, string> = {
  'case #': 'Case#',
  case: 'Case#',
  subcategory: 'Sub Category',
  'sub category': 'Sub Category',
  'buy smart action': 'Buysmart Action',
  buysmartaction: 'Buysmart Action',
  'if in-stock action': 'If In Stock: Action',
  'if in stock action': 'If In Stock: Action',
  dstdin: 'DSTDIN'
};

export const LOCAL_VENDOR_PATTERNS = [
  'baldor',
  'network',
  'unfi',
  'vesta',
  'vistar vending',
  'the chefs warehouse',
  "the chef's warehouse",
  'gourmet'
];

export const REFERENCE_LISTS: Record<string, string[]> = {
  local_vendors: LOCAL_VENDOR_PATTERNS,
  approved_manufacturers: [
    'great lakes',
    'sara lee frozen',
    'uproot',
    'evergood',
    'diversey',
    'passport',
    'european imports',
    'woodlands foods',
    "bob's red mill",
    'zero acres farms',
    'path water',
    'butterball',
    'sweet streets',
    'medtrition'
  ]
};

export function canonicalHeader(header: unknown): string {
  const raw = String(header ?? '').trim().replace(/\s+/g, ' ');
  const key = raw.toLowerCase().replace(/[_-]/g, ' ').trim();
  return HEADER_ALIASES[key] ?? raw;
}

export function cleanText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value).replace(/\s+/g, ' ').trim();
}

export function normalizeAction(value: unknown): string {
  const text = cleanText(value);
  if (!text) return '';
  if (/^ok$/i.test(text)) return 'OK';
  if (/^approved$/i.test(text)) return 'Approved';
  if (/^approved\s*-\s*1x$/i.test(text)) return 'Approved - 1X';
  if (/^blank$/i.test(text)) return '';
  return text;
}

export function parseNumberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const cleaned = String(value).replace(/,/g, '').replace(/%/g, '').trim();
  if (!cleaned || /^blank$/i.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parsePercentValue(value: unknown): number | null {
  const parsed = parseNumberValue(value);
  if (parsed === null) return null;
  return parsed > 1 ? parsed / 100 : parsed;
}

export function normalizeDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString();
  const text = cleanText(value);
  if (!text) return '';
  const parsed = new Date(text);
  return Number.isNaN(parsed.valueOf()) ? text : parsed.toISOString();
}

export function collapseRawRow(rawRow: Record<string, JsonValue>): Record<string, JsonValue> {
  const collapsed: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(rawRow)) {
    const header = canonicalHeader(key);
    const existing = collapsed[header];
    if (existing === undefined || cleanText(existing) === '') {
      collapsed[header] = value;
    }
  }
  return collapsed;
}

export function createNormalizedRow(rawRow: Record<string, JsonValue>): NormalizedRow {
  const source = collapseRawRow(rawRow);
  const field = (name: string): string => cleanText(source[name]);
  const numberField = (name: string): number | null => parseNumberValue(source[name]);
  const percentField = (name: string): number | null => parsePercentValue(source[name]);

  const fields: Record<string, JsonValue> = {
    business: field('Business'),
    requestType: field('Type'),
    caseNumber: field('Case#'),
    dateCreated: normalizeDate(source['Date Created']),
    sector: field('Sector'),
    division: field('Division'),
    unitName: field('Unit Name'),
    unitNumber: field('Unit Number'),
    vendor: field('Vendor'),
    din: field('DIN'),
    min: field('MIN'),
    manufacturer: field('Manufacturer'),
    brand: field('Brand'),
    description: field('Description'),
    parentCategory: field('Parent Category'),
    subCategory: field('Sub Category'),
    usageQty: numberField('Usage'),
    oneTimeOrPermanent: field('One-Time or Permanent'),
    reasonForRequest: field('Reason for request'),
    dpl: field('DPL'),
    meetsCriteria: percentField('Meets Criteria'),
    inCat: field('In CAT'),
    onMog: field('On MOG'),
    pantry: field('Pantry'),
    k12Apl: field('K12 APL'),
    compassApl: field('Compass APL'),
    conversionDin: field('Conversion DIN'),
    conversionVaPct: percentField('Conversion VA%'),
    upstreamAction: normalizeAction(source['ACTION']),
    upstreamIfInStockAction: normalizeAction(source['If In Stock: Action']),
    upstreamBuysmartAction: normalizeAction(source['Buysmart Action'])
  };

  const lower = (name: string): string => cleanText(fields[name]).toLowerCase();
  const actionKey = normalizeKey(fields['upstreamAction']);
  const buysmartKey = normalizeKey(fields['upstreamBuysmartAction']);
  const requestTypeKey = normalizeKey(fields['requestType']);
  const businessKey = normalizeKey(fields['business']);
  const compassApl = lower('compassApl');
  const pantry = lower('pantry');
  const division = lower('division');
  const reason = lower('reasonForRequest');
  const inCat = lower('inCat');
  const meetsCriteria = fields['meetsCriteria'] as number | null;
  const usageQty = fields['usageQty'] as number | null;

  const derived: Record<string, JsonValue> = {
    business_key: businessKey,
    request_type_key: requestTypeKey,
    is_compass: businessKey.includes('COMPASS USA'),
    is_canada: businessKey.includes('COMPASS CANADA'),
    is_healthtrust: businessKey.includes('HEALTHTRUST'),
    is_hmshost: businessKey.includes('HMSHOST'),
    is_foodbuyone: businessKey.includes('FOODBUYONE'),
    is_mass_add: requestTypeKey === 'MASS ADDS',
    is_mass_srf: requestTypeKey === 'MASS ADDS SRF',
    is_prf: requestTypeKey === 'PRF',
    is_sorf: requestTypeKey === 'SORF',
    is_srf: requestTypeKey === 'SRF',
    is_one_time: /one-time|one time|seasonal/i.test(cleanText(fields['oneTimeOrPermanent'])),
    is_permanent: /permanent/i.test(cleanText(fields['oneTimeOrPermanent'])),
    usage_num: usageQty,
    meets_criteria_num: meetsCriteria,
    meets_criteria_ge_10: typeof meetsCriteria === 'number' && meetsCriteria >= 0.1,
    in_cat_key: normalizeKey(fields['inCat']),
    is_in_cat_y: /^y$/i.test(cleanText(fields['inCat'])),
    is_temp_available: /temp available|ta/i.test(inCat),
    is_in_catalog: /^y$/i.test(cleanText(fields['inCat'])) || /temp available/i.test(inCat),
    is_pantry: pantry.includes('item') || pantry.includes('subcategory') || pantry === 'y',
    is_k12_apl: /^y$/i.test(cleanText(fields['k12Apl'])),
    is_core_apl: /core apl/i.test(cleanText(fields['compassApl'])),
    is_s1: /\bs1\b/i.test(cleanText(fields['compassApl'])),
    is_foh: /front of house|\bfoh\b/i.test(cleanText(fields['compassApl'])),
    is_diverse: /diverse/i.test(cleanText(fields['compassApl'])),
    has_conversion: cleanText(fields['conversionDin']) !== '',
    upstream_action_key: actionKey,
    current_action_key: actionKey,
    current_buysmart_key: buysmartKey,
    brand_lc: lower('brand'),
    manufacturer_lc: lower('manufacturer'),
    description_lc: lower('description'),
    subcategory_lc: lower('subCategory'),
    parent_category_lc: lower('parentCategory'),
    division_lc: division,
    sector_lc: lower('sector'),
    reason_lc: reason,
    vendor_lc: lower('vendor'),
    din_lc: lower('din'),
    min_lc: lower('min'),
    is_levy: lower('sector').includes('levy') || division.includes('levy'),
    is_schools: division.includes('school') || division.includes('chartwells')
  };

  return { source, fields, derived };
}

export function normalizeKey(value: unknown): string {
  return cleanText(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

export function rowToSearchText(row: WorkflowRow): string {
  return [
    row.caseNumber,
    row.vendor,
    row.description,
    row.brand,
    row.manufacturer,
    row.din,
    row.min,
    row.business,
    row.requestType,
    row.action,
    row.buysmartAction,
    row.outcomeReporting
  ]
    .join(' ')
    .toLowerCase();
}

export function createWorkflowRow(
  batchId: string,
  rawRow: Record<string, JsonValue>,
  sourceRowNumber: number,
  now: string,
  idFactory: () => string
): WorkflowRow {
  const normalized = createNormalizedRow(rawRow);
  const f = normalized.fields;
  const upstreamAction = cleanText(f['upstreamAction']);
  const upstreamIfInStockAction = cleanText(f['upstreamIfInStockAction']);
  const requestKey = `${cleanText(f['caseNumber']) || 'row'}-${sourceRowNumber}`;

  return {
    id: idFactory(),
    batchId,
    sourceRowNumber,
    workflowRequestKey: requestKey,
    rawRow: normalized.source,
    normalizedRow: normalized,
    business: cleanText(f['business']),
    requestType: cleanText(f['requestType']),
    caseNumber: cleanText(f['caseNumber']),
    dateCreated: cleanText(f['dateCreated']),
    sector: cleanText(f['sector']),
    division: cleanText(f['division']),
    unitName: cleanText(f['unitName']),
    unitNumber: cleanText(f['unitNumber']),
    vendor: cleanText(f['vendor']),
    din: cleanText(f['din']),
    min: cleanText(f['min']),
    manufacturer: cleanText(f['manufacturer']),
    brand: cleanText(f['brand']),
    description: cleanText(f['description']),
    parentCategory: cleanText(f['parentCategory']),
    subCategory: cleanText(f['subCategory']),
    usageQty: f['usageQty'] as number | null,
    oneTimeOrPermanent: cleanText(f['oneTimeOrPermanent']),
    reasonForRequest: cleanText(f['reasonForRequest']),
    dpl: cleanText(f['dpl']),
    meetsCriteria: f['meetsCriteria'] as number | null,
    inCat: cleanText(f['inCat']),
    onMog: cleanText(f['onMog']),
    pantry: cleanText(f['pantry']),
    k12Apl: cleanText(f['k12Apl']),
    compassApl: cleanText(f['compassApl']),
    conversionDin: cleanText(f['conversionDin']),
    conversionVaPct: f['conversionVaPct'] as number | null,
    upstreamAction,
    upstreamIfInStockAction,
    action: upstreamAction,
    ifInStockAction: upstreamIfInStockAction,
    buysmartAction: cleanText(f['upstreamBuysmartAction']),
    ruleApplied: '',
    executionTrace: [],
    needsReview: false,
    analystNotes: '',
    validationStatus: '',
    excluded: false,
    excludedReason: '',
    queueBucket: queueBucketForType(cleanText(f['requestType'])),
    requestBucket: cleanText(f['requestType']),
    outcomeReporting: 'assigned',
    selected: false,
    assignment: '',
    status: 'Ready',
    lastSyncAt: now,
    lastSavedAt: '',
    createdAt: now,
    updatedAt: now
  };
}

export function queueBucketForType(requestType: string): string {
  if (/mass adds/i.test(requestType)) return 'Mass Adds';
  if (/sorf|srf/i.test(requestType)) return 'SORF/SRF';
  if (/prf/i.test(requestType)) return 'PRF';
  return 'General Review';
}
