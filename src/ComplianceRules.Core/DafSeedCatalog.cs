using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

public sealed record RuleSeedCatalog(List<RuleDefinition> Rules, object Report);

public static class DafSeedCatalog
{
    private const string CompilerVersion = "2026-06-01.daf-logic-v2-dotnet";

    public static RuleSeedCatalog Build()
    {
        var workbook = LoadWorkbook();
        var grouped = workbook.LogicRows
            .GroupBy(row => row.RuleId)
            .OrderBy(group => RuleNumber(group.Key))
            .ToList();
        var duplicateRuleIds = workbook.LogicRows
            .GroupBy(row => row.RuleId)
            .Where(group => group.Count() > 1)
            .Select(group => group.Key)
            .ToArray();
        var now = DateTimeOffset.UtcNow;
        var rules = new List<RuleDefinition>();
        var executableVariants = 0;
        var guidedVariants = 0;
        var manualVariants = 0;

        foreach (var group in grouped)
        {
            var first = group.First();
            var definitionId = StableId($"definition:{group.Key}");
            var versionId = StableId($"version:{group.Key}:1");
            var variants = group.Select((row, index) =>
            {
                var compiled = Compile(row);
                var automationLevel = AutomationLevelFor(row, compiled.Spec);
                var status = StatusFor(automationLevel);
                if (automationLevel == "alpha") executableVariants++;
                if (automationLevel == "guided") guidedVariants++;
                if (automationLevel is "manual" or "future") manualVariants++;

                return new RuleVariant
                {
                    Id = StableId($"variant:{group.Key}:{index + 1}:{row.SourceRowNumber}"),
                    RuleDefinitionId = definitionId,
                    RuleVersionId = versionId,
                    RuleId = group.Key,
                    RuntimeRuleId = $"{group.Key}.{index + 1:00}",
                    RuntimeKind = compiled.Spec?.RuntimeKind ?? RuntimeKindFor(row),
                    ExecutionPriority = RuleNumber(group.Key) * 100 + index,
                    Enabled = status is "approved" or "ready",
                    IsExecutable = compiled.Spec is not null,
                    StopProcessing = compiled.Spec?.StopProcessing ?? false,
                    PredicateJson = compiled.Spec?.Predicate.DeepClone().AsObject(),
                    ActionJson = compiled.Spec?.Actions.DeepClone().AsArray(),
                    Description = compiled.Logic.FieldFilterLogic switch { "" => row.DecisionCriteria, var value => value },
                    AutomationLevel = automationLevel,
                    Status = status,
                    Source = SourceWithCompiledLogic(row, compiled.Logic),
                    CreatedAt = now
                };
            }).ToList();

            rules.Add(new RuleDefinition
            {
                Id = definitionId,
                RuleId = group.Key,
                Name = $"{(string.IsNullOrWhiteSpace(first.RuleGroup) ? "Rule" : first.RuleGroup)} {group.Key}",
                RuleGroup = first.RuleGroup,
                BusinessScope = first.Business,
                RequestTypes = SplitList(first.RequestTypes),
                DiscoveryReference = first.DiscoveryReference,
                Notes = string.Join(" | ", group.Select(row => row.Notes).Where(value => !string.IsNullOrWhiteSpace(value))),
                OwnerTeam = "Compliance Operations",
                VersionId = versionId,
                VersionNumber = 1,
                Status = variants.Any(variant => variant.Status == "approved") ? "approved" : "ready",
                AutomationLevel = RuleEditor.AggregateAutomation(variants),
                Variants = variants,
                CreatedAt = now,
                UpdatedAt = now
            });
        }

        var report = new
        {
            created = rules.Count,
            updated = 0,
            unchanged = 0,
            warnings = workbook.Warnings,
            duplicateRuleIds,
            sheetNames = workbook.SheetNames,
            executableVariants,
            guidedVariants,
            manualVariants
        };
        return new RuleSeedCatalog(rules, report);
    }

    private static DafSeedWorkbook LoadWorkbook()
    {
        var assembly = typeof(DafSeedCatalog).Assembly;
        var resourceName = assembly.GetManifestResourceNames().First(name => name.EndsWith("daf-seed.json", StringComparison.OrdinalIgnoreCase));
        using var stream = assembly.GetManifestResourceStream(resourceName) ?? throw new InvalidOperationException("Bundled rule catalog is missing.");
        return JsonSerializer.Deserialize<DafSeedWorkbook>(stream, JsonDefaults.Options) ?? throw new InvalidOperationException("Bundled rule catalog could not be read.");
    }

    private static CompiledRule Compile(DafLogicRow row)
    {
        var spec = ExecutableSpecFor(row);
        var fieldFilterLogic = FirstText(row.FieldFilterLogic, row.DecisionCriteria, $"{row.Business} {row.RequestTypes}".Trim());
        var aggregateLogic = FirstText(row.AggregateLogic, BuildAggregateLogic(row));
        var warnings = spec is null
            ? new[] { "This DAF row references judgment, external lookup data, or downstream handling and is stored for guided/manual execution." }
            : Array.Empty<string>();
        return new CompiledRule(spec, new CompiledRuleLogic(fieldFilterLogic, aggregateLogic, spec?.Predicate, spec?.Actions, spec is not null, warnings));
    }

    private static ExecutableSpec? ExecutableSpecFor(DafLogicRow row)
    {
        var criteria = row.DecisionCriteria.ToLowerInvariant();
        var business = row.Business.ToLowerInvariant();
        var requestTypes = row.RequestTypes.ToLowerInvariant();
        return row.RuleId switch
        {
            "R001" => new(Field("vendor_lc", "in_ref", "local_vendors"),
                Actions(
                    Action("exclude", ("reason", "Local/vendor exclusion from DAF R001")),
                    Action("add_note", ("value", "Removed from managed workflow by vendor exclusion."))
                ), true, "validation_rule"),
            "R002" => new(Any(Field("min_lc", "blank"), Field("din_lc", "blank")),
                Actions(
                    Action("set_action", ("value", "Invalid Information")),
                    Action("append_validation", ("value", "Missing MIN or DIN")),
                    Action("set_review", ("value", true)),
                    Action("set_buysmart", ("value", "Review"))
                ), true, "validation_rule"),
            "R004" => new(Field("is_hmshost", "is_true"),
                Actions(
                    Action("set_action", ("value", "Review")),
                    Action("set_buysmart", ("value", "Assigned")),
                    Action("set_review", ("value", true)),
                    Action("add_note", ("value", "Route as HMSHost."))
                )),
            "R005" => new(All(Field("is_canada", "is_true"), Field("is_mass_add", "is_true")),
                Actions(
                    Action("set_buysmart", ("value", "Assigned")),
                    Action("set_review", ("value", true)),
                    Action("add_note", ("value", "Canada mass add requires APL/Pantry confirmation."))
                )),
            "R006" => new(All(Field("is_canada", "is_true"), Field("is_prf", "is_true"), Any(Field("is_s1", "is_true"), Field("is_pantry", "is_true"))),
                Actions(
                    Action("preserve_action_set_if_stock", ("value", row.Action.Contains("Cannot", StringComparison.OrdinalIgnoreCase) ? "OK" : "")),
                    Action("set_action", ("value", string.IsNullOrWhiteSpace(row.Action) ? "OK" : row.Action), ("only_if_action_blank", true)),
                    Action("set_buysmart", ("value", "Assigned"))
                )),
            "R007" => new(All(Field("is_canada", "is_true"), Any(Field("is_prf", "is_true"), Field("is_sorf", "is_true"), Field("is_srf", "is_true")), Field("is_one_time", "is_true"), Field("usage_num", "le", 10), NotPreferredPredicate()),
                Actions(Action("set_action", ("value", "1X")), Action("set_if_stock", ("value", "OK")), Action("set_buysmart", ("value", "Assigned")))),
            "R008" => new(All(Field("is_canada", "is_true"), Field("is_one_time", "is_true"), Field("usage_num", "gt", 10), NotPreferredPredicate()),
                Actions(Action("set_buysmart", ("value", "Review")), Action("set_review", ("value", true)), Action("add_note", ("value", "Canada one-time usage above 10 requires escalation.")))),
            "R011" => new(All(Field("is_healthtrust", "is_true"), Field("is_prf", "is_true"), Field("has_conversion", "is_true")),
                Actions(Action("set_action", ("value", "Use Right")), Action("set_buysmart", ("value", "Assigned")))),
            "R012" when criteria.Contains("is not") || criteria.Contains("does not") => new(All(Field("is_healthtrust", "is_true"), NotPreferredPredicate()),
                Actions(Action("set_action", ("value", "Review")), Action("set_buysmart", ("value", "Assigned")), Action("set_review", ("value", true)))),
            "R012" => new(All(Field("is_healthtrust", "is_true"), Any(Field("is_prf", "is_true"), Field("is_sorf", "is_true")), PreferredPredicate()),
                Actions(Action("set_action_by_duration"), Action("set_buysmart", ("value", string.IsNullOrWhiteSpace(row.BuysmartAction) ? "Assigned" : row.BuysmartAction)))),
            "R014" when business.Contains("healthtrust") => new(All(Field("is_healthtrust", "is_true"), Field("is_sorf", "is_true"), Field("has_conversion", "is_true"), Field("usage_num", "lt", 10)),
                Actions(Action("set_action", ("value", "Use Right")), Action("set_buysmart", ("value", "Review")), Action("set_review", ("value", true)))),
            "R014" => new(All(Field("is_compass", "is_true"), Field("is_srf", "is_true"), Field("has_conversion", "is_true")),
                Actions(Action("set_action", ("value", "Use Right")), Action("set_buysmart", ("value", "Assigned")))),
            "R016" => new(All(Field("is_compass", "is_true"), Any(Field("reason_lc", "contains", "sponsorship"), Field("reason_lc", "contains", "menucycle"))),
                Actions(Action("set_action_by_duration"), Action("set_buysmart", ("value", "Assigned")))),
            "R023" => new(All(Field("is_compass", "is_true"), Any(Field("is_prf", "is_true"), Field("is_sorf", "is_true")), Any(Field("is_s1", "is_true"), Field("is_foh", "is_true"), Field("is_diverse", "is_true"), Field("is_core_apl", "is_true"))),
                Actions(Action("set_action_by_duration"), Action("preserve_action_set_if_stock", ("value", "OK")))),
            "R024" => new(All(Field("is_compass", "is_true"), Field("is_schools", "is_true"), Field("is_k12_apl", "is_true")), Actions(Action("set_action_by_duration"))),
            "R025" => new(Field("is_pantry", "is_true"), Actions(Action("set_action_by_duration"))),
            "R026" => new(Field("meets_criteria_ge_10", "is_true"), Actions(Action("set_action_by_duration"))),
            "R027" => new(Any(Field("reason_lc", "contains", "sponsorship"), Field("reason_lc", "contains", "commodity"), Field("reason_lc", "contains", "allocation")), Actions(Action("set_action_by_duration"))),
            "R028" => new(Field("description_lc", "regex", "halal|gluten free|sugar free|vegan|kosher|\\bgf\\b|puree|nutritional"), Actions(Action("set_action_by_duration"))),
            "R036" => new(All(Field("is_one_time", "is_true"), Field("usage_num", "lt", 15)),
                Actions(Action("set_action", ("value", "1X"), ("only_if_action_blank", true)), Action("set_buysmart", ("value", "Assigned")))),
            "R041" => new(All(Field("is_compass", "is_true"), Field("is_prf", "is_true"), Field("is_permanent", "is_true"), Any(Field("current_action_key", "eq", "OK"), Field("current_action_key", "contains", "ON MOG")), Field("is_in_cat_y", "is_true"), Field("din_lc", "not_contains", "new")),
                Actions(Action("set_buysmart", ("value", "Approved"))), false, "buysmart_rule"),
            "R042" => new(All(Any(Field("is_in_cat_y", "is_false"), Field("is_temp_available", "is_true")), Field("current_action_key", "contains", "CANNOT ADD")),
                Actions(Action("set_buysmart", ("value", "Denied"))), false, "buysmart_rule"),
            "R043" => new(Any(Field("is_mass_add", "is_true"), Field("is_mass_srf", "is_true")), Actions(Action("set_buysmart", ("value", "Assigned"))), false, "buysmart_rule"),
            "R044" => new(Field("current_buysmart_key", "blank"), Actions(Action("set_buysmart", ("value", "Assigned"))), false, "buysmart_rule"),
            "R047" => new(All(Field("is_prf", "is_true"), Field("current_action_key", "eq", "1X")), Actions(Action("set_buysmart", ("value", "Approved"))), false, "downstream_rule"),
            "R048" => new(All(Field("is_prf", "is_true"), Field("current_action_key", "contains", "ON MOG")), Actions(Action("set_buysmart", ("value", "Approved"))), false, "downstream_rule"),
            _ when requestTypes.Contains("approved rows") => new(Field("current_buysmart_key", "eq", "APPROVED"), Actions(Action("add_note", ("value", FirstText(row.DownstreamHandling, row.SetAction)))), false, "downstream_rule"),
            _ => null
        };
    }

    private static JsonObject PreferredPredicate() => Any(
        Field("is_s1", "is_true"),
        Field("is_foh", "is_true"),
        Field("is_diverse", "is_true"),
        Field("is_core_apl", "is_true"),
        Field("is_pantry", "is_true"),
        Field("meets_criteria_ge_10", "is_true"));

    private static JsonObject NotPreferredPredicate() => Not(PreferredPredicate());

    private static string BuildAggregateLogic(DafLogicRow row)
    {
        var parts = new[]
        {
            string.IsNullOrWhiteSpace(row.Action) ? "" : $"ACTION: {row.Action}",
            string.IsNullOrWhiteSpace(row.IfInStockAction) ? "" : $"If In Stock: {row.IfInStockAction}",
            string.IsNullOrWhiteSpace(row.BuysmartAction) ? "" : $"BuySmart Action: {row.BuysmartAction}",
            string.IsNullOrWhiteSpace(row.SetAction) ? "" : $"Set ACTION: {row.SetAction}",
            string.IsNullOrWhiteSpace(row.DownstreamHandling) ? "" : $"Downstream: {row.DownstreamHandling}"
        };
        return string.Join(" | ", parts.Where(part => !string.IsNullOrWhiteSpace(part)));
    }

    private static JsonObject SourceWithCompiledLogic(DafLogicRow row, CompiledRuleLogic logic) => new()
    {
        ["ruleId"] = row.RuleId,
        ["ruleGroup"] = row.RuleGroup,
        ["business"] = row.Business,
        ["requestTypes"] = row.RequestTypes,
        ["decisionCriteria"] = row.DecisionCriteria,
        ["action"] = row.Action,
        ["ifInStockAction"] = row.IfInStockAction,
        ["buysmartAction"] = row.BuysmartAction,
        ["dailyActionFileColumns"] = row.DailyActionFileColumns,
        ["setAction"] = row.SetAction,
        ["downstreamHandling"] = row.DownstreamHandling,
        ["discoveryReference"] = row.DiscoveryReference,
        ["notes"] = row.Notes,
        ["sourceRowNumber"] = row.SourceRowNumber,
        ["fieldFilterLogic"] = logic.FieldFilterLogic,
        ["aggregateLogic"] = logic.AggregateLogic,
        ["logic"] = string.Join(" => ", new[] { logic.FieldFilterLogic, logic.AggregateLogic }.Where(value => !string.IsNullOrWhiteSpace(value))),
        ["compiledLogic"] = new JsonObject
        {
            ["compilerVersion"] = CompilerVersion,
            ["fieldFilterLogic"] = logic.FieldFilterLogic,
            ["aggregateLogic"] = logic.AggregateLogic,
            ["predicateJson"] = logic.Predicate?.DeepClone(),
            ["actionJson"] = logic.Actions?.DeepClone(),
            ["executable"] = logic.Executable,
            ["warnings"] = new JsonArray(logic.Warnings.Select(item => (JsonNode?)JsonValue.Create(item)).ToArray())
        }
    };

    private static string AutomationLevelFor(DafLogicRow row, ExecutableSpec? spec)
    {
        if (spec is not null) return "alpha";
        var text = $"{row.DecisionCriteria} {row.SetAction} {row.DownstreamHandling} {row.Notes}".ToLowerInvariant();
        if (text.Contains("external") || text.Contains("matrix") || text.Contains("judgment") || text.Contains("follow up")) return "manual";
        if (text.Contains("manual") || text.Contains("review") || text.Contains("specialist")) return "guided";
        return "future";
    }

    private static string StatusFor(string automationLevel) => automationLevel switch
    {
        "alpha" => "approved",
        "guided" => "ready",
        _ => "draft"
    };

    private static string RuntimeKindFor(DafLogicRow row)
    {
        var group = row.RuleGroup.ToLowerInvariant();
        if (group.Contains("closeout")) return "buysmart_rule";
        if (group.Contains("upload") || group.Contains("splitting")) return "downstream_rule";
        if (group.Contains("pre-processing")) return "validation_rule";
        return "row_rule";
    }

    private static JsonObject Field(string field, string op, object? value = null)
    {
        var predicate = new JsonObject { ["field"] = field, ["op"] = op };
        if (value is not null) predicate["value"] = JsonValue.Create(value);
        return predicate;
    }

    private static JsonObject All(params JsonObject[] predicates) => new() { ["all"] = new JsonArray(predicates.Select(item => (JsonNode?)item).ToArray()) };
    private static JsonObject Any(params JsonObject[] predicates) => new() { ["any"] = new JsonArray(predicates.Select(item => (JsonNode?)item).ToArray()) };
    private static JsonObject Not(JsonObject predicate) => new() { ["not"] = predicate };
    private static JsonArray Actions(params JsonObject[] actions) => new(actions.Select(item => (JsonNode?)item).ToArray());

    private static JsonObject Action(string type, params (string Key, object? Value)[] values)
    {
        var action = new JsonObject { ["type"] = type };
        foreach (var (key, value) in values)
        {
            action[key] = value switch
            {
                bool flag => flag,
                int number => number,
                decimal number => number,
                null => null,
                _ => JsonValue.Create(value.ToString())
            };
        }
        return action;
    }

    private static Guid StableId(string input)
    {
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(input))).ToLowerInvariant();
        return Guid.Parse($"{hash[..8]}-{hash.Substring(8, 4)}-{hash.Substring(12, 4)}-{hash.Substring(16, 4)}-{hash.Substring(20, 12)}");
    }

    private static int RuleNumber(string ruleId)
    {
        var digits = new string(ruleId.Where(char.IsDigit).ToArray());
        return int.TryParse(digits, out var parsed) ? parsed : 9999;
    }

    private static List<string> SplitList(string text) =>
        text.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();

    private static string FirstText(params string?[] values) =>
        values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))?.Trim() ?? "";

    private sealed record CompiledRule(ExecutableSpec? Spec, CompiledRuleLogic Logic);
    private sealed record CompiledRuleLogic(string FieldFilterLogic, string AggregateLogic, JsonObject? Predicate, JsonArray? Actions, bool Executable, string[] Warnings);
    private sealed record ExecutableSpec(JsonObject Predicate, JsonArray Actions, bool StopProcessing = false, string RuntimeKind = "row_rule");

    private sealed class DafSeedWorkbook
    {
        public string[] SheetNames { get; set; } = [];
        public List<DafLogicRow> LogicRows { get; set; } = [];
        public string[] Warnings { get; set; } = [];
    }

    private sealed class DafLogicRow
    {
        public string RuleId { get; set; } = "";
        public string RuleGroup { get; set; } = "";
        public string Business { get; set; } = "";
        public string RequestTypes { get; set; } = "";
        public string DecisionCriteria { get; set; } = "";
        public string Action { get; set; } = "";
        public string IfInStockAction { get; set; } = "";
        public string BuysmartAction { get; set; } = "";
        public string DailyActionFileColumns { get; set; } = "";
        public string SetAction { get; set; } = "";
        public string DownstreamHandling { get; set; } = "";
        public string DiscoveryReference { get; set; } = "";
        public string Notes { get; set; } = "";
        public int SourceRowNumber { get; set; }
        public string FieldFilterLogic { get; set; } = "";
        public string AggregateLogic { get; set; } = "";
    }
}
