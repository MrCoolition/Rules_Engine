using Microsoft.Extensions.Primitives;

public static class RowFilters
{
    public static object Apply(IReadOnlyList<WorkflowRow> rows, IQueryCollection query)
    {
        var page = Math.Max(IntValue(query, "page", 1), 1);
        var pageSize = Math.Clamp(IntValue(query, "pageSize", 50), 1, 250);
        var search = Text(query, "search").ToLowerInvariant();
        var business = Text(query, "business");
        var type = Text(query, "type");
        var status = Text(query, "status");
        var buysmartAction = Text(query, "buysmartAction");
        var outcome = Text(query, "outcome");
        var bucket = Text(query, "bucket");
        var needsReview = query.TryGetValue("needsReview", out var nr) ? nr : StringValues.Empty;
        var excluded = query.TryGetValue("excluded", out var ex) ? ex : StringValues.Empty;

        var filtered = rows.Where(row =>
        {
            if (!string.IsNullOrWhiteSpace(search) && !SearchText(row).Contains(search, StringComparison.OrdinalIgnoreCase)) return false;
            if (!string.IsNullOrWhiteSpace(business) && row.Business != business) return false;
            if (!string.IsNullOrWhiteSpace(type) && row.RequestType != type) return false;
            if (!string.IsNullOrWhiteSpace(status) && row.Status != status) return false;
            if (!string.IsNullOrWhiteSpace(buysmartAction) && row.BuysmartAction != buysmartAction) return false;
            if (!string.IsNullOrWhiteSpace(outcome) && row.OutcomeReporting != outcome) return false;
            if (!string.IsNullOrWhiteSpace(bucket) && RuleEngine.BucketForRow(row).Id != bucket) return false;
            if (!StringValues.IsNullOrEmpty(needsReview) && row.NeedsReview.ToString().ToLowerInvariant() != needsReview.ToString().ToLowerInvariant()) return false;
            if (!StringValues.IsNullOrEmpty(excluded) && row.Excluded.ToString().ToLowerInvariant() != excluded.ToString().ToLowerInvariant()) return false;
            return true;
        }).ToList();

        var start = (page - 1) * pageSize;
        return new
        {
            rows = filtered.Skip(start).Take(pageSize).Select(row =>
            {
                row.QueueBucket = RuleEngine.BucketForRow(row).Label;
                return row;
            }).ToList(),
            total = filtered.Count,
            page,
            pageSize
        };
    }

    private static string SearchText(WorkflowRow row) =>
        string.Join(' ', row.CaseNumber, row.Vendor, row.Description, row.Brand, row.Manufacturer, row.Din, row.Min, row.Business, row.RequestType, row.Action, row.BuysmartAction, row.OutcomeReporting).ToLowerInvariant();

    private static int IntValue(IQueryCollection query, string key, int fallback) =>
        int.TryParse(Text(query, key), out var parsed) ? parsed : fallback;

    private static string Text(IQueryCollection query, string key) =>
        query.TryGetValue(key, out var value) ? value.ToString() : "";
}

