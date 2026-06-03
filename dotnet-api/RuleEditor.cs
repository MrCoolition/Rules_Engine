using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Globalization;

public static partial class RuleEditor
{
    private const string CompilerVersion = "2026-06-01.daf-logic-v2-dotnet";

    private static readonly Dictionary<string, string> FieldLabels = new()
    {
        ["business_key"] = "Business",
        ["request_type_key"] = "Request type",
        ["vendor_lc"] = "Vendor",
        ["din_lc"] = "DIN",
        ["min_lc"] = "MIN",
        ["manufacturer_lc"] = "Manufacturer",
        ["brand_lc"] = "Brand",
        ["description_lc"] = "Description",
        ["parent_category_lc"] = "Parent category",
        ["subcategory_lc"] = "Sub category",
        ["usage_num"] = "Usage",
        ["meets_criteria_num"] = "Meets criteria",
        ["current_action_key"] = "Current ACTION",
        ["current_buysmart_key"] = "Current BuySmart action",
        ["is_compass"] = "Compass USA",
        ["is_canada"] = "Compass Canada",
        ["is_healthtrust"] = "HealthTrust",
        ["is_hmshost"] = "HMSHost",
        ["is_prf"] = "PRF",
        ["is_sorf"] = "SORF",
        ["is_srf"] = "SRF",
        ["is_one_time"] = "One-time request",
        ["is_permanent"] = "Permanent request",
        ["is_pantry"] = "Pantry/APL",
        ["is_in_catalog"] = "In catalog"
    };

    private static readonly HashSet<string> Operators = ["eq", "ne", "in", "not_in", "contains", "not_contains", "blank", "not_blank", "gt", "ge", "lt", "le", "is_true", "is_false"];
    private static readonly HashSet<string> NoValueOperators = ["blank", "not_blank", "is_true", "is_false"];
    private static readonly HashSet<string> NumericOperators = ["gt", "ge", "lt", "le"];
    private static readonly Dictionary<string, string> OperatorLabels = new()
    {
        ["eq"] = "equals",
        ["ne"] = "does not equal",
        ["in"] = "is in",
        ["not_in"] = "is not in",
        ["contains"] = "contains",
        ["not_contains"] = "does not contain",
        ["blank"] = "is blank",
        ["not_blank"] = "is not blank",
        ["gt"] = ">",
        ["ge"] = ">=",
        ["lt"] = "<",
        ["le"] = "<=",
        ["is_true"] = "is true",
        ["is_false"] = "is false"
    };

    public static RuleDefinition CreateUserRule(RuleCreateRequest request, IReadOnlyList<RuleDefinition> existingRules)
    {
        var ruleId = CleanRuleId(request.RuleId) is { Length: > 0 } cleaned ? cleaned : NextUserRuleId(existingRules);
        if (existingRules.Any(rule => rule.RuleId.Equals(ruleId, StringComparison.OrdinalIgnoreCase))) throw new InvalidOperationException($"Rule {ruleId} already exists.");
        if (string.IsNullOrWhiteSpace(request.Name)) throw new InvalidOperationException("Rule name is required.");

        var now = DateTimeOffset.UtcNow;
        var definitionId = Guid.NewGuid();
        var versionId = Guid.NewGuid();
        var predicate = PredicateFromFilter(request.Filter);
        var actions = ActionsFromBody(request.Actions);
        var fieldFilterLogic = FilterLogicText(request.Filter);
        var aggregateLogic = AggregateLogicText(actions);
        var requestTypes = RequestTypesFromBody(request.RequestTypes);
        var priority = Math.Max(900000, existingRules.SelectMany(rule => rule.Variants).Select(variant => variant.ExecutionPriority + 10).DefaultIfEmpty(900000).Max());
        var source = UserRuleSource(ruleId, request, requestTypes, fieldFilterLogic, aggregateLogic, predicate, actions);

        return new RuleDefinition
        {
            Id = definitionId,
            RuleId = ruleId,
            Name = request.Name.Trim(),
            RuleGroup = string.IsNullOrWhiteSpace(request.RuleGroup) ? "User Managed" : request.RuleGroup.Trim(),
            BusinessScope = string.IsNullOrWhiteSpace(request.BusinessScope) ? "All" : request.BusinessScope.Trim(),
            RequestTypes = requestTypes,
            DiscoveryReference = "Created in Compliance Rules",
            Notes = request.Notes?.Trim() ?? "",
            OwnerTeam = "Compliance Operations",
            VersionId = versionId,
            VersionNumber = 1,
            Status = request.Enabled ? "approved" : "disabled",
            AutomationLevel = "alpha",
            CreatedAt = now,
            UpdatedAt = now,
            Variants =
            [
                new RuleVariant
                {
                    Id = Guid.NewGuid(),
                    RuleDefinitionId = definitionId,
                    RuleVersionId = versionId,
                    RuleId = ruleId,
                    RuntimeRuleId = $"{ruleId}.01",
                    RuntimeKind = "row_rule",
                    ExecutionPriority = priority,
                    Enabled = request.Enabled,
                    IsExecutable = true,
                    StopProcessing = request.StopProcessing,
                    PredicateJson = predicate,
                    ActionJson = actions,
                    Description = fieldFilterLogic,
                    AutomationLevel = "alpha",
                    Status = request.Enabled ? "approved" : "disabled",
                    Source = source,
                    CreatedAt = now
                }
            ]
        };
    }

    public static RuleDefinition UpdateRule(RuleDefinition rule, RuleCreateRequest request)
    {
        var requestedRuleId = CleanRuleId(request.RuleId);
        if (!string.IsNullOrWhiteSpace(requestedRuleId) && !requestedRuleId.Equals(rule.RuleId, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("Rule ID cannot be changed. Create a new rule for a new ID.");
        }
        if (string.IsNullOrWhiteSpace(request.Name)) throw new InvalidOperationException("Rule name is required.");
        if (rule.Variants.Count == 0) throw new InvalidOperationException("This rule has no editable variant.");

        var predicate = PredicateFromFilter(request.Filter);
        var actions = ActionsFromBody(request.Actions);
        var fieldFilterLogic = FilterLogicText(request.Filter);
        var aggregateLogic = AggregateLogicText(actions);
        var requestTypes = RequestTypesFromBody(request.RequestTypes);
        var ruleGroup = string.IsNullOrWhiteSpace(request.RuleGroup) ? rule.RuleGroup : request.RuleGroup.Trim();
        var businessScope = string.IsNullOrWhiteSpace(request.BusinessScope) ? rule.BusinessScope : request.BusinessScope.Trim();
        var primary = rule.Variants[0];
        primary.Enabled = request.Enabled;
        primary.IsExecutable = true;
        primary.StopProcessing = request.StopProcessing;
        primary.PredicateJson = predicate;
        primary.ActionJson = actions;
        primary.Description = fieldFilterLogic;
        primary.AutomationLevel = "alpha";
        primary.Status = request.Enabled ? "approved" : "disabled";
        var sourceRequest = new RuleCreateRequest
        {
            RuleId = request.RuleId,
            Name = request.Name,
            RuleGroup = ruleGroup,
            BusinessScope = businessScope,
            RequestTypes = request.RequestTypes,
            Filter = request.Filter,
            Actions = request.Actions,
            Enabled = request.Enabled,
            StopProcessing = request.StopProcessing,
            Notes = request.Notes
        };
        primary.Source = UserRuleSource(rule.RuleId, sourceRequest, requestTypes, fieldFilterLogic, aggregateLogic, predicate, actions);

        if (!request.Enabled)
        {
            foreach (var variant in rule.Variants)
            {
                variant.Enabled = false;
                variant.Status = "disabled";
            }
        }

        rule.Name = request.Name.Trim();
        rule.RuleGroup = ruleGroup;
        rule.BusinessScope = businessScope;
        rule.RequestTypes = requestTypes;
        rule.Notes = request.Notes?.Trim() ?? "";
        rule.Status = request.Enabled ? "approved" : "disabled";
        rule.AutomationLevel = "alpha";
        rule.UpdatedAt = DateTimeOffset.UtcNow;
        return rule;
    }

    public static RuleDefinition SetEnabled(RuleDefinition rule, bool enabled)
    {
        var hasExecutable = rule.Variants.Any(variant => variant.IsExecutable);
        rule.Status = enabled ? hasExecutable ? "approved" : "ready" : "disabled";
        rule.UpdatedAt = DateTimeOffset.UtcNow;
        foreach (var variant in rule.Variants)
        {
            variant.Enabled = enabled && variant.IsExecutable;
            variant.Status = enabled ? variant.IsExecutable ? "approved" : "ready" : "disabled";
        }
        return rule;
    }

    public static bool HasEditPayload(JsonObject body) =>
        new[] { "name", "ruleGroup", "businessScope", "requestTypes", "filter", "actions", "stopProcessing", "notes" }.Any(body.ContainsKey);

    public static bool IsBundledRuleId(string ruleId) => BundledRuleRegex().IsMatch(ruleId);

    public static string AggregateAutomation(IEnumerable<RuleVariant> variants)
    {
        var levels = variants.Select(variant => variant.AutomationLevel).ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (levels.Contains("alpha")) return "alpha";
        if (levels.Contains("guided")) return "guided";
        if (levels.Contains("manual")) return "manual";
        return "future";
    }

    public static object ReportFromRules(IReadOnlyList<RuleDefinition> rules)
    {
        var variants = rules.SelectMany(rule => rule.Variants).ToList();
        return new
        {
            created = 0,
            updated = 0,
            unchanged = rules.Count,
            warnings = Array.Empty<string>(),
            duplicateRuleIds = Array.Empty<string>(),
            sheetNames = Array.Empty<string>(),
            executableVariants = variants.Count(variant => variant.Enabled && variant.IsExecutable && variant.Status == "approved"),
            guidedVariants = variants.Count(variant => variant.AutomationLevel == "guided"),
            manualVariants = variants.Count(variant => variant.AutomationLevel is "manual" or "future")
        };
    }

    private static JsonObject PredicateFromFilter(FilterRequest filter)
    {
        var field = filter.Field?.Trim() ?? "";
        var op = filter.Op?.Trim() ?? "";
        if (!FieldLabels.ContainsKey(field)) throw new InvalidOperationException("Choose a supported filter field.");
        if (!Operators.Contains(op)) throw new InvalidOperationException("Choose a supported filter operator.");
        var predicate = new JsonObject { ["field"] = field, ["op"] = op };
        if (NoValueOperators.Contains(op)) return predicate;
        predicate["value"] = FilterValue(op, filter.Value);
        if (string.IsNullOrWhiteSpace(Normalizer.CleanText(predicate["value"]))) throw new InvalidOperationException("Filter value is required.");
        return predicate;
    }

    private static JsonNode? FilterValue(string op, JsonNode? value)
    {
        if (NumericOperators.Contains(op))
        {
            var text = Normalizer.CleanText(value);
            if (!decimal.TryParse(text, NumberStyles.Any, CultureInfo.InvariantCulture, out var parsed)) throw new InvalidOperationException("Filter value must be a number.");
            return parsed;
        }
        if (op is "in" or "not_in")
        {
            return new JsonArray(Normalizer.CleanText(value).Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Select(item => JsonValue.Create(item)).ToArray());
        }
        return Normalizer.CleanText(value);
    }

    private static JsonArray ActionsFromBody(ActionRequest body)
    {
        var actions = new JsonArray();
        if (body.Exclude) actions.Add(new JsonObject { ["type"] = "exclude", ["reason"] = string.IsNullOrWhiteSpace(body.ExcludeReason) ? "User-managed exclusion rule" : body.ExcludeReason });
        if (!string.IsNullOrWhiteSpace(body.Action)) actions.Add(new JsonObject { ["type"] = "set_action", ["value"] = body.Action.Trim() });
        if (!string.IsNullOrWhiteSpace(body.IfInStockAction)) actions.Add(new JsonObject { ["type"] = "set_if_stock", ["value"] = body.IfInStockAction.Trim() });
        if (!string.IsNullOrWhiteSpace(body.BuysmartAction)) actions.Add(new JsonObject { ["type"] = "set_buysmart", ["value"] = body.BuysmartAction.Trim() });
        if (body.Review) actions.Add(new JsonObject { ["type"] = "set_review", ["value"] = true });
        if (!string.IsNullOrWhiteSpace(body.Validation)) actions.Add(new JsonObject { ["type"] = "append_validation", ["value"] = body.Validation.Trim() });
        if (!string.IsNullOrWhiteSpace(body.Note)) actions.Add(new JsonObject { ["type"] = "add_note", ["value"] = body.Note.Trim() });
        if (actions.Count == 0) throw new InvalidOperationException("Add at least one rule action.");
        return actions;
    }

    private static string FilterLogicText(FilterRequest filter)
    {
        var label = FieldLabels.GetValueOrDefault(filter.Field, filter.Field);
        var op = OperatorLabels.GetValueOrDefault(filter.Op, filter.Op);
        return NoValueOperators.Contains(filter.Op) ? $"{label} {op}" : $"{label} {op} {Normalizer.CleanText(filter.Value)}";
    }

    private static string AggregateLogicText(JsonArray actions)
    {
        return string.Join(" | ", actions.OfType<JsonObject>().Select(action =>
        {
            var type = Normalizer.CleanText(action["type"]);
            return type switch
            {
                "exclude" => $"Exclude: {Normalizer.CleanText(action["reason"]) switch { "" => "matched row", var reason => reason }}",
                "set_review" => "Flag for review",
                "append_validation" => $"Validation: {Normalizer.CleanText(action["value"])}",
                "add_note" => $"Note: {Normalizer.CleanText(action["value"])}",
                "set_action" => $"Set ACTION: {Normalizer.CleanText(action["value"])}",
                "set_if_stock" => $"Set If In Stock: {Normalizer.CleanText(action["value"])}",
                "set_buysmart" => $"Set BuySmart: {Normalizer.CleanText(action["value"])}",
                _ => type
            };
        }));
    }

    private static List<string> RequestTypesFromBody(string? value) =>
        (value ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();

    private static JsonObject UserRuleSource(string ruleId, RuleCreateRequest request, List<string> requestTypes, string fieldFilterLogic, string aggregateLogic, JsonObject predicate, JsonArray actions)
    {
        return new JsonObject
        {
            ["ruleId"] = ruleId,
            ["ruleGroup"] = string.IsNullOrWhiteSpace(request.RuleGroup) ? "User Managed" : request.RuleGroup.Trim(),
            ["business"] = string.IsNullOrWhiteSpace(request.BusinessScope) ? "All" : request.BusinessScope.Trim(),
            ["requestTypes"] = string.Join(", ", requestTypes),
            ["decisionCriteria"] = fieldFilterLogic,
            ["action"] = request.Actions.Action ?? "",
            ["ifInStockAction"] = request.Actions.IfInStockAction ?? "",
            ["buysmartAction"] = request.Actions.BuysmartAction ?? "",
            ["dailyActionFileColumns"] = "",
            ["setAction"] = aggregateLogic,
            ["downstreamHandling"] = request.Actions.Note ?? "",
            ["discoveryReference"] = "Created in Compliance Rules",
            ["notes"] = request.Notes ?? "",
            ["sourceRowNumber"] = 0,
            ["fieldFilterLogic"] = fieldFilterLogic,
            ["aggregateLogic"] = aggregateLogic,
            ["logic"] = $"{fieldFilterLogic} => {aggregateLogic}",
            ["compiledLogic"] = new JsonObject
            {
                ["compilerVersion"] = CompilerVersion,
                ["fieldFilterLogic"] = fieldFilterLogic,
                ["aggregateLogic"] = aggregateLogic,
                ["predicateJson"] = predicate.DeepClone(),
                ["actionJson"] = actions.DeepClone(),
                ["executable"] = true,
                ["warnings"] = new JsonArray()
            }
        };
    }

    private static string CleanRuleId(string? value) => RuleIdUnsafeRegex().Replace((value ?? "").Trim().ToUpperInvariant(), "");

    private static string NextUserRuleId(IEnumerable<RuleDefinition> rules)
    {
        var max = rules.Select(rule => UserRuleRegex().Match(rule.RuleId)).Where(match => match.Success).Select(match => int.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture)).DefaultIfEmpty(0).Max();
        return $"U{max + 1:000}";
    }

    [GeneratedRegex("^R\\d+$", RegexOptions.IgnoreCase)]
    private static partial Regex BundledRuleRegex();
    [GeneratedRegex("[^A-Z0-9_-]")]
    private static partial Regex RuleIdUnsafeRegex();
    [GeneratedRegex("^U(\\d+)$", RegexOptions.IgnoreCase)]
    private static partial Regex UserRuleRegex();
}
