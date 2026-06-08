using System.Text;
using System.Text.Json.Nodes;
using ClosedXML.Excel;

public static class WorkbookParser
{
    private static readonly Dictionary<string, string> HeaderAliases = new(StringComparer.OrdinalIgnoreCase)
    {
        ["case #"] = "Case#",
        ["case"] = "Case#",
        ["subcategory"] = "Sub Category",
        ["sub category"] = "Sub Category",
        ["buy smart action"] = "Buysmart Action",
        ["buysmartaction"] = "Buysmart Action",
        ["if in-stock action"] = "If In Stock: Action",
        ["if in stock action"] = "If In Stock: Action",
        ["dstdin"] = "DSTDIN"
    };

    public static ParsedWorkbook ParseSourceWorkbook(string fileName, byte[] bytes)
    {
        using var stream = new MemoryStream(bytes);
        using var workbook = new XLWorkbook(stream);
        var worksheet = workbook.Worksheets.FirstOrDefault() ?? throw new InvalidOperationException("Source workbook has no worksheets.");
        var headers = ReadHeaderRow(worksheet, 1);
        var rows = new List<JsonObject>();
        var warnings = new List<string>();

        foreach (var row in worksheet.RowsUsed().Where(row => row.RowNumber() > 1))
        {
            var record = new JsonObject();
            var hasValue = false;
            for (var index = 0; index < headers.Count; index++)
            {
                var value = CellToJson(row.Cell(index + 1));
                if (!string.IsNullOrWhiteSpace(Normalizer.CleanText(value))) hasValue = true;
                var header = headers[index];
                if (!record.ContainsKey(header) || string.IsNullOrWhiteSpace(Normalizer.CleanText(record[header])))
                {
                    record[header] = value;
                }
            }
            if (hasValue) rows.Add(record);
        }

        if (!headers.Contains("Buysmart Action", StringComparer.OrdinalIgnoreCase))
        {
            warnings.Add("Source workbook does not include Buysmart Action; engine output will create it.");
        }

        return new ParsedWorkbook(fileName, worksheet.Name, headers, rows, warnings);
    }

    public static byte[] ExportRows(IReadOnlyList<WorkflowRow> rows)
    {
        using var workbook = new XLWorkbook();
        var worksheet = workbook.Worksheets.Add("Outcomes");
        var headers = ExportHeaders();
        for (var col = 0; col < headers.Length; col++) worksheet.Cell(1, col + 1).Value = headers[col];
        for (var rowIndex = 0; rowIndex < rows.Count; rowIndex++)
        {
            var row = rows[rowIndex];
            for (var col = 0; col < headers.Length; col++) worksheet.Cell(rowIndex + 2, col + 1).Value = ExportValue(row, headers[col]);
        }
        worksheet.Row(1).Style.Font.Bold = true;
        worksheet.Columns().AdjustToContents(14, 36);
        using var stream = new MemoryStream();
        workbook.SaveAs(stream);
        return stream.ToArray();
    }

    public static string ExportCsv(IReadOnlyList<WorkflowRow> rows)
    {
        var headers = ExportHeaders();
        var builder = new StringBuilder();
        builder.AppendLine(string.Join(',', headers));
        foreach (var row in rows)
        {
            builder.AppendLine(string.Join(',', headers.Select(header => CsvCell(ExportValue(row, header)))));
        }
        return builder.ToString();
    }

    private static List<string> ReadHeaderRow(IXLWorksheet worksheet, int rowNumber)
    {
        var row = worksheet.Row(rowNumber);
        var lastCell = Math.Max(row.LastCellUsed()?.Address.ColumnNumber ?? 0, worksheet.LastColumnUsed()?.ColumnNumber() ?? 0);
        var headers = new List<string>();
        for (var col = 1; col <= lastCell; col++)
        {
            var header = CanonicalHeader(Normalizer.CleanText(CellToJson(row.Cell(col))));
            headers.Add(string.IsNullOrWhiteSpace(header) ? $"Column {col}" : header);
        }
        return headers;
    }

    private static string CanonicalHeader(string header)
    {
        var raw = string.Join(' ', header.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries));
        var key = raw.ToLowerInvariant().Replace("_", " ").Replace("-", " ").Trim();
        return HeaderAliases.TryGetValue(key, out var alias) ? alias : raw;
    }

    private static JsonNode? CellToJson(IXLCell cell)
    {
        if (cell.IsEmpty()) return "";
        if (cell.DataType == XLDataType.Boolean) return cell.GetBoolean();
        if (cell.DataType == XLDataType.Number)
        {
            return cell.TryGetValue<DateTime>(out var date) && cell.Style.DateFormat.Format.Length > 0
                ? date.ToString("O")
                : cell.GetDouble();
        }
        if (cell.DataType == XLDataType.DateTime) return cell.GetDateTime().ToString("O");
        return cell.GetFormattedString();
    }

    private static string[] ExportHeaders() =>
    [
        "Business",
        "Type",
        "Case#",
        "Vendor",
        "DIN",
        "MIN",
        "Description",
        "ACTION",
        "If In Stock: Action",
        "Buysmart Action",
        "Assigned Bucket",
        "Rule Applied",
        "Needs Review",
        "Validation Status",
        "Compliance Bucket",
        "Outcome Reporting",
        "Analyst Notes"
    ];

    private static string ExportValue(WorkflowRow row, string header) => header switch
    {
        "Business" => row.Business,
        "Type" => row.RequestType,
        "Case#" => row.CaseNumber,
        "Vendor" => row.Vendor,
        "DIN" => row.Din,
        "MIN" => row.Min,
        "Description" => row.Description,
        "ACTION" => row.Action,
        "If In Stock: Action" => row.IfInStockAction,
        "Buysmart Action" => row.BuysmartAction,
        "Assigned Bucket" => RuleEngine.BucketForRow(row).Label,
        "Rule Applied" => row.RuleApplied,
        "Needs Review" => row.NeedsReview ? "TRUE" : "FALSE",
        "Validation Status" => row.ValidationStatus,
        "Compliance Bucket" => RuleEngine.BucketForRow(row).Label,
        "Outcome Reporting" => row.OutcomeReporting,
        "Analyst Notes" => row.AnalystNotes,
        _ => ""
    };

    private static string CsvCell(string value)
    {
        if (!value.Contains(',') && !value.Contains('"') && !value.Contains('\n')) return value;
        return $"\"{value.Replace("\"", "\"\"")}\"";
    }
}
