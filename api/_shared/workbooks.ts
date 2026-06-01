import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import type { DafLogicRow, JsonValue, ParsedDafWorkbook, ParsedSourceWorkbook } from './types.js';
import { canonicalHeader, cleanText } from './normalize.js';

export const DEFAULT_DAF_FILE = 'DAF - Logic Matrix - In Progress.xlsx';
export const DEFAULT_SOURCE_FILE = 'PRF_SORF_SRF_05_26_2026 TEST.xlsx';

export async function loadWorkbookFile(fileName: string): Promise<Buffer> {
  const candidates = [
    path.join(process.cwd(), fileName),
    path.join('C:\\Coolition_Engine\\Rules Engine', fileName)
  ];
  for (const candidate of candidates) {
    try {
      return await fs.readFile(candidate);
    } catch {
      // Try the next location.
    }
  }
  throw new Error(`Workbook not found: ${fileName}`);
}

export async function workbookExists(fileName: string): Promise<boolean> {
  try {
    await loadWorkbookFile(fileName);
    return true;
  } catch {
    return false;
  }
}

export async function parseSourceWorkbook(fileName: string, buffer: Buffer): Promise<ParsedSourceWorkbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error('Source workbook has no worksheets.');

  const headers = readHeaderRow(worksheet, 1);
  const rows: Record<string, JsonValue>[] = [];
  const warnings: string[] = [];

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const record: Record<string, JsonValue> = {};
    let hasValue = false;
    headers.forEach((header, index) => {
      const value = cellToJsonValue(row.getCell(index + 1).value);
      if (cleanText(value) !== '') hasValue = true;
      const existing = record[header];
      if (existing === undefined || cleanText(existing) === '') {
        record[header] = value;
      }
    });
    if (hasValue) rows.push(record);
  });

  if (!headers.includes('Buysmart Action')) {
    warnings.push('Source workbook does not include Buysmart Action; engine output will create it.');
  }

  return {
    fileName,
    sheetName: worksheet.name,
    columns: headers,
    rows,
    warnings,
    fileSha256: crypto.createHash('sha256').update(buffer).digest('hex')
  };
}

export async function parseDafWorkbook(fileName: string, buffer: Buffer): Promise<ParsedDafWorkbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheetNames = workbook.worksheets.map((sheet) => sheet.name);
  const logicSheet = workbook.getWorksheet('Logic Matrix');
  if (!logicSheet) throw new Error('DAF workbook is missing the Logic Matrix sheet.');

  const headerRowNumber = findHeaderRow(logicSheet, 'Rule ID');
  if (!headerRowNumber) throw new Error('Logic Matrix is missing a Rule ID header row.');
  const headers = readHeaderRow(logicSheet, headerRowNumber);
  const headerIndex = new Map(headers.map((header, index) => [header, index + 1]));
  const logicRows: DafLogicRow[] = [];
  const warnings: string[] = [];

  logicSheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowNumber) return;
    const ruleId = cleanText(cellToJsonValue(row.getCell(headerIndex.get('Rule ID') ?? 1).value));
    if (!ruleId) return;
    logicRows.push({
      ruleId,
      ruleGroup: getCell(row, headerIndex, 'Rule Group'),
      business: getCell(row, headerIndex, 'Business'),
      requestTypes: getCell(row, headerIndex, 'Request Type (s)'),
      decisionCriteria: getCell(row, headerIndex, 'Decision Criteria'),
      action: getCell(row, headerIndex, 'Action'),
      ifInStockAction: getCell(row, headerIndex, 'If In-Stock Action'),
      buysmartAction: getCell(row, headerIndex, 'BuySmart Action'),
      dailyActionFileColumns: getCell(row, headerIndex, 'Daily Action File Columns'),
      setAction: getCell(row, headerIndex, 'Set ACTION'),
      downstreamHandling: getCell(row, headerIndex, 'Downstream Handling'),
      discoveryReference: getCell(row, headerIndex, 'Discovery Document Reference'),
      notes: getCell(row, headerIndex, 'Notes / Dependencies'),
      sourceRowNumber: rowNumber
    });
  });

  if (logicRows.length === 0) warnings.push('No DAF logic rows were detected.');

  return {
    fileName,
    sheetNames,
    logicRows,
    requestTypes: readTable(workbook.getWorksheet('Request Types')),
    dailyActionFields: readTable(workbook.getWorksheet('Daily Action Fields')),
    actionValues: readTable(workbook.getWorksheet('Action Values')),
    evaluationOrder: readTable(workbook.getWorksheet('Evaluation Order')),
    sources: readTable(workbook.getWorksheet('Sources')),
    warnings
  };
}

function getCell(row: ExcelJS.Row, headerIndex: Map<string, number>, header: string): string {
  const index = headerIndex.get(header);
  return index ? cleanText(cellToJsonValue(row.getCell(index).value)) : '';
}

function readHeaderRow(worksheet: ExcelJS.Worksheet, rowNumber: number): string[] {
  const row = worksheet.getRow(rowNumber);
  const headers: string[] = [];
  row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    const header = canonicalHeader(cellToJsonValue(cell.value));
    if (header) headers[colNumber - 1] = header;
  });
  return headers.map((header, index) => header || `Column ${index + 1}`);
}

function findHeaderRow(worksheet: ExcelJS.Worksheet, requiredHeader: string): number | null {
  for (let rowNumber = 1; rowNumber <= Math.min(worksheet.rowCount, 10); rowNumber += 1) {
    const headers = readHeaderRow(worksheet, rowNumber);
    if (headers.includes(requiredHeader)) return rowNumber;
  }
  return null;
}

function readTable(worksheet: ExcelJS.Worksheet | undefined): Record<string, JsonValue>[] {
  if (!worksheet) return [];
  const headerRowNumber = findFirstDataHeader(worksheet);
  if (!headerRowNumber) return [];
  const headers = readHeaderRow(worksheet, headerRowNumber);
  const records: Record<string, JsonValue>[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowNumber) return;
    const record: Record<string, JsonValue> = {};
    let hasValue = false;
    headers.forEach((header, index) => {
      const value = cellToJsonValue(row.getCell(index + 1).value);
      if (cleanText(value) !== '') hasValue = true;
      record[header] = value;
    });
    if (hasValue) records.push(record);
  });
  return records;
}

function findFirstDataHeader(worksheet: ExcelJS.Worksheet): number | null {
  for (let rowNumber = 1; rowNumber <= Math.min(worksheet.rowCount, 10); rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    let count = 0;
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (cleanText(cellToJsonValue(cell.value)) !== '') count += 1;
    });
    if (count >= 2) return rowNumber;
  }
  return null;
}

export function cellToJsonValue(value: ExcelJS.CellValue): JsonValue {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text;
    if ('result' in value) return cellToJsonValue(value.result as ExcelJS.CellValue);
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('');
    }
    if ('hyperlink' in value && 'text' in value && typeof value.text === 'string') return value.text;
  }
  return cleanText(value);
}
