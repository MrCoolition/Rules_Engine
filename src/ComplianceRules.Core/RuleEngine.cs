using System.Text.Json;
using System.Text.Json.Nodes;
using System.Globalization;
using System.Text.RegularExpressions;

public static class RuleEngine
{
    private static readonly Dictionary<string, string[]> ReferenceLists = new(StringComparer.OrdinalIgnoreCase)
    {
        ["local_vendors"] =
        [
            "Baldor",
            "Network",
            "UNFI",
            "Vesta",
            "Vistar Vending",
            "The Chefs Warehouse",
            "Gourmet"
        ]
    };

    private static readonly BucketDefinition[] Buckets =
    [
        new("auto-approved", "Auto Approved", "Rows the engine can approve cleanly from DAF logic.", "good"),
        new("approved-1x", "Approved 1X", "One-time approved requests and PRF 1X closeout rows.", "good"),
        new("vendor-exclusions", "Vendor Exclusions", "Rows removed from the managed workflow by vendor/pre-processing rules.", "dark"),
        new("data-issues", "Data Issues", "Rows missing required identifiers or carrying invalid source data.", "bad"),
        new("denied", "Denied / Cannot Add", "Rows the rules classify as denied, cannot add, or not in stock.", "bad"),
        new("use-right", "Use Right / Conversion", "Rows routed to conversion/use-right handling.", "info"),
        new("find-alt", "Find Alt First", "Rows that need an alternate item before approval or denial.", "warn"),
        new("cdm-review", "CDM Review", "Rows that need category manager review.", "warn"),
        new("compliance-review", "Compliance Review", "Rows the engine flagged for analyst or compliance review.", "warn"),
        new("assigned-processing", "Assigned for Processing", "Rows assigned to a specialist or downstream operational workflow.", "info")
    ];

    public static ExecuteRowsResult ExecuteRows(IReadOnlyList<WorkflowRow> inputRows, IReadOnlyList<RuleDefinition> rules, IReadOnlyList<Guid>? rowIds = null)
    {
        var variants = ExecutableVariants(rules).ToList();
        var selected = rowIds is { Count: > 0 } ? rowIds.ToHashSet() : null;
        var changed = 0;
        var review = 0;
        var rows = new List<WorkflowRow>();
        foreach (var row in inputRows)
        {
            if (selected is not null && !selected.Contains(row.Id))
            {
                rows.Add(row);
                continue;
            }
            var before = DecisionSnapshot(row);
            var executed = ExecuteRow(Clone(row), variants);
            var after = DecisionSnapshot(executed);
            if (before != after) changed++;
            if (executed.NeedsReview) review++;
            rows.Add(executed);
        }
        return new ExecuteRowsResult(rows, changed, review);
    }

    public static IEnumerable<RuleVariant> ExecutableVariants(IEnumerable<RuleDefinition> rules) =>
        rules.SelectMany(rule => rule.Variants)
            .Where(variant => variant.Enabled && variant.IsExecutable && variant.Status == "approved")
            .OrderBy(variant => variant.ExecutionPriority);

    public static WorkflowRow ExecuteRow(WorkflowRow input, IEnumerable<RuleVariant> variants)
    {
        var now = DateTimeOffset.UtcNow;
        var row = RefreshDerived(input);
        row.ExecutionTrace = new JsonArray();
        row.RuleApplied = "";
        var variantList = variants.ToList();

        if (variantList.Count == 0)
        {
            row.NeedsReview = true;
            row.ValidationStatus = Normalizer.AppendText(row.ValidationStatus, "Executable rule catalog missing");
            row.OutcomeReporting = ClassifyOutcome(row);
            row.QueueBucket = BucketForRow(row).Label;
            row.UpdatedAt = now;
            return row;
        }

        foreach (var variant in variantList)
        {
            var context = ContextForRow(row);
            if (variant.PredicateJson is null || !EvaluatePredicate(variant.PredicateJson, context)) continue;
            ApplyActions(row, variant.ActionJson ?? new JsonArray(), variant);
            row.ExecutionTrace.Add(new JsonObject
            {
                ["runtimeRuleId"] = variant.RuntimeRuleId,
                ["ruleId"] = variant.RuleId,
                ["description"] = variant.Description,
                ["actionSummary"] = SummarizeActions(variant.ActionJson ?? new JsonArray()),
                ["matchedAt"] = now.ToString("O"),
                ["automationLevel"] = variant.AutomationLevel
            });
            row.RuleApplied = Normalizer.AppendText(row.RuleApplied, variant.RuntimeRuleId);
            row = RefreshDerived(row);
            if (variant.StopProcessing) break;
        }

        if (string.IsNullOrWhiteSpace(row.BuysmartAction) && !row.Excluded)
        {
            row.BuysmartAction = row.NeedsReview ? "Review" : "Assigned";
        }
        row.Status = row.Excluded ? "Excluded" : row.NeedsReview ? "Review" : "Ready";
        row.OutcomeReporting = ClassifyOutcome(row);
        row.QueueBucket = BucketForRow(row).Label;
        row.UpdatedAt = now;
        return row;
    }

    public static WorkflowRow ApplyRowPatch(WorkflowRow row, JsonObject patch)
    {
        var editable = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "action",
            "ifInStockAction",
            "buysmartAction",
            "needsReview",
            "analystNotes",
            "assignment",
            "status",
            "selected",
            "validationStatus"
        };
        foreach (var item in patch)
        {
            if (!editable.Contains(item.Key)) continue;
            switch (item.Key)
            {
                case "action":
                    row.Action = Normalizer.NormalizeAction(item.Value);
                    break;
                case "ifInStockAction":
                    row.IfInStockAction = Normalizer.NormalizeAction(item.Value);
                    break;
                case "buysmartAction":
                    row.BuysmartAction = Normalizer.NormalizeAction(item.Value);
                    break;
                case "needsReview":
                    row.NeedsReview = item.Value?.GetValue<bool>() ?? false;
                    break;
                case "analystNotes":
                    row.AnalystNotes = Normalizer.CleanText(item.Value);
                    break;
                case "assignment":
                    row.Assignment = Normalizer.CleanText(item.Value);
                    break;
                case "status":
                    row.Status = Normalizer.CleanText(item.Value);
                    break;
                case "selected":
                    row.Selected = item.Value?.GetValue<bool>() ?? false;
                    break;
                case "validationStatus":
                    row.ValidationStatus = Normalizer.CleanText(item.Value);
                    break;
            }
        }
        row.LastSavedAt = DateTimeOffset.UtcNow.ToString("O");
        row.UpdatedAt = DateTimeOffset.UtcNow;
        row.OutcomeReporting = ClassifyOutcome(row);
        row.QueueBucket = BucketForRow(row).Label;
        return RefreshDerived(row);
    }

    public static object SummarizeBatch(IReadOnlyList<WorkflowRow> rows)
    {
        var rowCount = rows.Count;
        var reviewCount = rows.Count(row => row.NeedsReview);
        var excludedCount = rows.Count(row => row.Excluded);
        var approvedCount = rows.Count(row => row.BuysmartAction.Contains("Approved", StringComparison.OrdinalIgnoreCase));
        var deniedCount = rows.Count(row => row.BuysmartAction.Contains("Denied", StringComparison.OrdinalIgnoreCase) || row.Action.Contains("Cannot Add", StringComparison.OrdinalIgnoreCase));
        var assignedCount = rows.Count(row => row.BuysmartAction.Contains("Assigned", StringComparison.OrdinalIgnoreCase));
        return new
        {
            rowCount,
            reviewCount,
            excludedCount,
            approvedCount,
            deniedCount,
            assignedCount,
            outcomeCounts = rows.GroupBy(row => row.OutcomeReporting).Where(group => !string.IsNullOrWhiteSpace(group.Key)).ToDictionary(group => group.Key, group => group.Count()),
            businessCounts = rows.GroupBy(row => row.Business).Where(group => !string.IsNullOrWhiteSpace(group.Key)).ToDictionary(group => group.Key, group => group.Count()),
            typeCounts = rows.GroupBy(row => row.RequestType).Where(group => !string.IsNullOrWhiteSpace(group.Key)).ToDictionary(group => group.Key, group => group.Count()),
            bucketSummaries = SummarizeBuckets(rows),
            automationCoveragePct = rowCount == 0 ? 0 : Math.Round(rows.Count(row => !string.IsNullOrWhiteSpace(row.RuleApplied)) * 100m / rowCount, 1)
        };
    }

    public static string ClassifyOutcome(WorkflowRow row)
    {
        if (row.Excluded) return "Excluded";
        if (!string.IsNullOrWhiteSpace(row.ValidationStatus)) return "Data Issue";
        if (row.NeedsReview) return "Review";
        if (row.Action.Contains("Cannot Add", StringComparison.OrdinalIgnoreCase) || row.BuysmartAction.Contains("Denied", StringComparison.OrdinalIgnoreCase)) return "Denied";
        if (row.Action.Contains("Find Alt", StringComparison.OrdinalIgnoreCase)) return "Find Alt First";
        if (row.Action.Contains("Use Right", StringComparison.OrdinalIgnoreCase)) return "Use Right";
        if (row.Action.Contains("1X", StringComparison.OrdinalIgnoreCase) || row.BuysmartAction.Contains("1X", StringComparison.OrdinalIgnoreCase)) return "Approved - 1X";
        if (row.Action.Contains("OK", StringComparison.OrdinalIgnoreCase) || row.BuysmartAction.Contains("Approved", StringComparison.OrdinalIgnoreCase)) return "Approved";
        if (row.BuysmartAction.Contains("Assigned", StringComparison.OrdinalIgnoreCase)) return "Assigned";
        return "Pending";
    }

    public static JsonObject CatalogSnapshot(IEnumerable<RuleDefinition> rules)
    {
        return new JsonObject
        {
            ["ruleCount"] = rules.Count(),
            ["variantCount"] = rules.SelectMany(rule => rule.Variants).Count(),
            ["capturedAt"] = DateTimeOffset.UtcNow.ToString("O")
        };
    }

    public static List<RowExecutionResult> CreateResults(Guid runId, IReadOnlyList<WorkflowRow> beforeRows, IReadOnlyList<WorkflowRow> afterRows, IReadOnlyList<Guid>? rowIds = null)
    {
        var selected = rowIds is { Count: > 0 } ? rowIds.ToHashSet() : null;
        var beforeById = beforeRows.ToDictionary(row => row.Id);
        return afterRows
            .Where(row => selected is null || selected.Contains(row.Id))
            .Where(row => row.ExecutionTrace.Count > 0 || DecisionSnapshot(row) != DecisionSnapshot(beforeById.GetValueOrDefault(row.Id) ?? row))
            .Select(row =>
            {
                var before = beforeById.GetValueOrDefault(row.Id) ?? row;
                return new RowExecutionResult
                {
                    Id = Guid.NewGuid(),
                    RunId = runId,
                    WorkflowRowId = row.Id,
                    BeforeState = before,
                    AfterState = row,
                    Trace = row.ExecutionTrace.DeepClone().AsArray(),
                    RulesApplied = new JsonArray(row.ExecutionTrace.OfType<JsonObject>().Select(trace => trace["runtimeRuleId"]?.DeepClone()).Where(node => node is not null).ToArray()),
                    Validations = new JsonArray(row.ValidationStatus.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Select(item => JsonValue.Create(item)).ToArray()),
                    CreatedAt = DateTimeOffset.UtcNow
                };
            })
            .ToList();
    }

    public static BucketDefinition BucketForRow(WorkflowRow row)
    {
        BucketDefinition Find(string id) => Buckets.First(bucket => bucket.Id == id);
        if (row.Excluded) return Find("vendor-exclusions");
        if (!string.IsNullOrWhiteSpace(row.ValidationStatus)) return Find("data-issues");
        if (row.Action.Contains("Cannot Add", StringComparison.OrdinalIgnoreCase) || row.BuysmartAction.Contains("Denied", StringComparison.OrdinalIgnoreCase)) return Find("denied");
        if (row.Action.Contains("Use Right", StringComparison.OrdinalIgnoreCase)) return Find("use-right");
        if (row.Action.Contains("Find Alt", StringComparison.OrdinalIgnoreCase)) return Find("find-alt");
        if (row.NeedsReview) return Find("compliance-review");
        if (row.Action.Contains("1X", StringComparison.OrdinalIgnoreCase)) return Find("approved-1x");
        if (row.Action.Contains("OK", StringComparison.OrdinalIgnoreCase) || row.BuysmartAction.Contains("Approved", StringComparison.OrdinalIgnoreCase)) return Find("auto-approved");
        return Find("assigned-processing");
    }

    private static bool EvaluatePredicate(JsonObject predicate, JsonObject context)
    {
        if (predicate["all"] is JsonArray all) return all.OfType<JsonObject>().All(item => EvaluatePredicate(item, context));
        if (predicate["any"] is JsonArray any) return any.OfType<JsonObject>().Any(item => EvaluatePredicate(item, context));
        if (predicate["not"] is JsonObject not) return !EvaluatePredicate(not, context);
        var field = Normalizer.CleanText(predicate["field"]);
        var op = Normalizer.CleanText(predicate["op"]);
        var left = context[field];
        var right = predicate["value"];
        return op switch
        {
            "eq" => string.Equals(Normalizer.NormalizeKey(left), Normalizer.NormalizeKey(right), StringComparison.OrdinalIgnoreCase),
            "ne" => !string.Equals(Normalizer.NormalizeKey(left), Normalizer.NormalizeKey(right), StringComparison.OrdinalIgnoreCase),
            "contains" => Normalizer.CleanText(left).Contains(Normalizer.CleanText(right), StringComparison.OrdinalIgnoreCase),
            "not_contains" => !Normalizer.CleanText(left).Contains(Normalizer.CleanText(right), StringComparison.OrdinalIgnoreCase),
            "blank" => string.IsNullOrWhiteSpace(Normalizer.CleanText(left)),
            "not_blank" => !string.IsNullOrWhiteSpace(Normalizer.CleanText(left)),
            "is_true" => BoolValue(left),
            "is_false" => !BoolValue(left),
            "gt" => NumberValue(left) > NumberValue(right),
            "ge" => NumberValue(left) >= NumberValue(right),
            "lt" => NumberValue(left) < NumberValue(right),
            "le" => NumberValue(left) <= NumberValue(right),
            "in" => InList(left, right),
            "not_in" => !InList(left, right),
            "in_ref" => InReferenceList(left, right),
            "not_in_ref" => !InReferenceList(left, right),
            "regex" => Regex.IsMatch(Normalizer.CleanText(left), Normalizer.CleanText(right), RegexOptions.IgnoreCase),
            "not_regex" => !Regex.IsMatch(Normalizer.CleanText(left), Normalizer.CleanText(right), RegexOptions.IgnoreCase),
            _ => false
        };
    }

    private static void ApplyActions(WorkflowRow row, JsonArray actions, RuleVariant variant)
    {
        foreach (var node in actions.OfType<JsonObject>())
        {
            var context = ContextForRow(row);
            if (node["when"] is JsonObject when && !EvaluatePredicate(when, context)) continue;
            if (BoolValue(node["only_if_action_blank"]) && !string.IsNullOrWhiteSpace(row.Action)) continue;

            var type = Normalizer.CleanText(node["type"]);
            switch (type)
            {
                case "set_action":
                    row.Action = Normalizer.NormalizeAction(node["value"]);
                    break;
                case "set_action_by_duration":
                    row.Action = row.OneTimeOrPermanent.Contains("one", StringComparison.OrdinalIgnoreCase) || row.OneTimeOrPermanent.Contains("seasonal", StringComparison.OrdinalIgnoreCase) ? "1X" : "OK";
                    break;
                case "set_if_stock":
                    row.IfInStockAction = Normalizer.NormalizeAction(node["value"]);
                    break;
                case "set_buysmart":
                    row.BuysmartAction = Normalizer.NormalizeAction(node["value"]);
                    break;
                case "set_review":
                    row.NeedsReview = node["value"]?.GetValue<bool>() ?? true;
                    break;
                case "append_validation":
                    row.ValidationStatus = Normalizer.AppendText(row.ValidationStatus, Normalizer.CleanText(node["value"]));
                    break;
                case "add_note":
                    row.AnalystNotes = Normalizer.AppendText(row.AnalystNotes, Normalizer.CleanText(node["value"]));
                    break;
                case "exclude":
                    row.Excluded = true;
                    row.ExcludedReason = Normalizer.CleanText(node["reason"]) switch { "" => variant.Description, var reason => reason };
                    row.NeedsReview = false;
                    row.BuysmartAction = "";
                    break;
                case "clear_field":
                    if (Normalizer.CleanText(node["field"]) == "Conversion DIN") row.ConversionDin = "";
                    break;
                case "preserve_action_set_if_stock":
                    if (!string.IsNullOrWhiteSpace(row.UpstreamAction) && (row.UpstreamAction.Contains("on mog", StringComparison.OrdinalIgnoreCase) || row.UpstreamAction.Contains("cannot add", StringComparison.OrdinalIgnoreCase)))
                    {
                        row.Action = row.UpstreamAction;
                        row.IfInStockAction = Normalizer.NormalizeAction(node["value"]);
                    }
                    break;
            }
        }
    }

    private static WorkflowRow RefreshDerived(WorkflowRow row)
    {
        var source = row.RawRow.DeepClone().AsObject();
        source["ACTION"] = row.UpstreamAction;
        source["If In Stock: Action"] = row.UpstreamIfInStockAction;
        source["Buysmart Action"] = row.BuysmartAction;
        row.NormalizedRow = Normalizer.CreateNormalizedRow(source);
        row.NormalizedRow["derived"]!.AsObject()["current_action_key"] = Normalizer.NormalizeKey(row.Action);
        row.NormalizedRow["derived"]!.AsObject()["current_buysmart_key"] = Normalizer.NormalizeKey(row.BuysmartAction);
        row.QueueBucket = string.IsNullOrWhiteSpace(row.QueueBucket) ? Normalizer.QueueBucketForType(row.RequestType) : row.QueueBucket;
        return row;
    }

    private static JsonObject ContextForRow(WorkflowRow row)
    {
        var context = new JsonObject();
        foreach (var item in row.NormalizedRow["fields"]!.AsObject()) context[item.Key] = item.Value?.DeepClone();
        foreach (var item in row.NormalizedRow["derived"]!.AsObject()) context[item.Key] = item.Value?.DeepClone();
        context["current_action_key"] = Normalizer.NormalizeKey(row.Action);
        context["current_buysmart_key"] = Normalizer.NormalizeKey(row.BuysmartAction);
        context["action"] = row.Action;
        context["buysmartAction"] = row.BuysmartAction;
        return context;
    }

    private static List<object> SummarizeBuckets(IReadOnlyList<WorkflowRow> rows) =>
        Buckets.Select(bucket =>
        {
            var bucketRows = rows.Where(row => BucketForRow(row).Id == bucket.Id).ToList();
            return new
            {
                id = bucket.Id,
                label = bucket.Label,
                description = bucket.Description,
                tone = bucket.Tone,
                count = bucketRows.Count,
                reviewCount = bucketRows.Count(row => row.NeedsReview),
                outcomeKeys = bucketRows.Select(row => row.OutcomeReporting).Where(value => !string.IsNullOrWhiteSpace(value)).Distinct().Order().ToArray(),
                ruleIds = bucketRows.SelectMany(row => row.RuleApplied.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)).Distinct().Order().ToArray(),
                examples = bucketRows.Take(3).Select(row => new
                {
                    rowId = row.Id,
                    caseNumber = row.CaseNumber,
                    vendor = row.Vendor,
                    description = row.Description,
                    action = row.Action,
                    buysmartAction = row.BuysmartAction,
                    outcomeReporting = row.OutcomeReporting,
                    ruleApplied = row.RuleApplied
                }).ToArray()
            };
        }).Where(bucket => bucket.count > 0).Cast<object>().ToList();

    private static string SummarizeActions(JsonArray actions) =>
        string.Join(", ", actions.OfType<JsonObject>().Select(action => Normalizer.CleanText(action["value"]) switch
        {
            "" => Normalizer.CleanText(action["type"]),
            var value => $"{Normalizer.CleanText(action["type"])}: {value}"
        }));

    private static string DecisionSnapshot(WorkflowRow row) =>
        $"{row.Action}|{row.IfInStockAction}|{row.BuysmartAction}|{row.NeedsReview}|{row.Excluded}|{row.OutcomeReporting}";

    private static WorkflowRow Clone(WorkflowRow row) =>
        JsonSerializer.Deserialize<WorkflowRow>(JsonSerializer.Serialize(row, JsonDefaults.Options), JsonDefaults.Options) ?? row;

    private static bool BoolValue(JsonNode? node) =>
        node?.GetValueKind() switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.String => bool.TryParse(node.GetValue<string>(), out var parsed) && parsed,
            JsonValueKind.Number => node.GetValue<decimal>() != 0,
            _ => !string.IsNullOrWhiteSpace(Normalizer.CleanText(node))
        };

    private static decimal NumberValue(JsonNode? node) =>
        decimal.TryParse(Normalizer.CleanText(node), NumberStyles.Any, CultureInfo.InvariantCulture, out var parsed) ? parsed : 0;

    private static bool InList(JsonNode? left, JsonNode? right)
    {
        var value = Normalizer.NormalizeKey(left);
        if (right is JsonArray array) return array.Any(item => Normalizer.NormalizeKey(item) == value);
        return Normalizer.CleanText(right).Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Any(item => Normalizer.NormalizeKey(item) == value);
    }

    private static bool InReferenceList(JsonNode? left, JsonNode? right)
    {
        var key = Normalizer.CleanText(right);
        var value = Normalizer.CleanText(left);
        return ReferenceLists.TryGetValue(key, out var list) &&
            list.Any(item => value.Contains(item, StringComparison.OrdinalIgnoreCase));
    }
}

public sealed record BucketDefinition(string Id, string Label, string Description, string Tone);
