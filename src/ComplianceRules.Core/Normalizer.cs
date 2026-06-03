using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

public static partial class Normalizer
{
    public static WorkflowRow CreateWorkflowRow(Guid batchId, JsonObject rawRow, int sourceRowNumber, DateTimeOffset now)
    {
        var normalized = CreateNormalizedRow(rawRow);
        var fields = normalized["fields"]!.AsObject();
        var upstreamAction = CleanText(fields["upstreamAction"]);
        var upstreamIfInStockAction = CleanText(fields["upstreamIfInStockAction"]);
        var row = new WorkflowRow
        {
            Id = Guid.NewGuid(),
            BatchId = batchId,
            SourceRowNumber = sourceRowNumber,
            WorkflowRequestKey = $"{CleanText(fields["caseNumber"]) switch { "" => "row", var value => value }}-{sourceRowNumber}",
            RawRow = normalized["source"]!.AsObject().DeepClone().AsObject(),
            NormalizedRow = normalized,
            Business = CleanText(fields["business"]),
            RequestType = CleanText(fields["requestType"]),
            CaseNumber = CleanText(fields["caseNumber"]),
            DateCreated = CleanText(fields["dateCreated"]),
            Sector = CleanText(fields["sector"]),
            Division = CleanText(fields["division"]),
            UnitName = CleanText(fields["unitName"]),
            UnitNumber = CleanText(fields["unitNumber"]),
            Vendor = CleanText(fields["vendor"]),
            Din = CleanText(fields["din"]),
            Min = CleanText(fields["min"]),
            Manufacturer = CleanText(fields["manufacturer"]),
            Brand = CleanText(fields["brand"]),
            Description = CleanText(fields["description"]),
            ParentCategory = CleanText(fields["parentCategory"]),
            SubCategory = CleanText(fields["subCategory"]),
            UsageQty = DecimalValue(fields["usageQty"]),
            OneTimeOrPermanent = CleanText(fields["oneTimeOrPermanent"]),
            ReasonForRequest = CleanText(fields["reasonForRequest"]),
            Dpl = CleanText(fields["dpl"]),
            MeetsCriteria = DecimalValue(fields["meetsCriteria"]),
            InCat = CleanText(fields["inCat"]),
            OnMog = CleanText(fields["onMog"]),
            Pantry = CleanText(fields["pantry"]),
            K12Apl = CleanText(fields["k12Apl"]),
            CompassApl = CleanText(fields["compassApl"]),
            ConversionDin = CleanText(fields["conversionDin"]),
            ConversionVaPct = DecimalValue(fields["conversionVaPct"]),
            UpstreamAction = upstreamAction,
            UpstreamIfInStockAction = upstreamIfInStockAction,
            Action = upstreamAction,
            IfInStockAction = upstreamIfInStockAction,
            BuysmartAction = CleanText(fields["upstreamBuysmartAction"]),
            QueueBucket = QueueBucketForType(CleanText(fields["requestType"])),
            RequestBucket = QueueBucketForType(CleanText(fields["requestType"])),
            Status = "Ready",
            CreatedAt = now,
            UpdatedAt = now
        };
        row.OutcomeReporting = RuleEngine.ClassifyOutcome(row);
        return row;
    }

    public static JsonObject CreateNormalizedRow(JsonObject rawRow)
    {
        var source = CollapseRawRow(rawRow);
        string Field(string name) => CleanText(source[name]);
        decimal? NumberField(string name) => ParseNumber(source[name]);
        decimal? PercentField(string name)
        {
            var parsed = ParseNumber(source[name]);
            return parsed is null ? null : parsed > 1 ? parsed / 100 : parsed;
        }

        var fields = new JsonObject
        {
            ["business"] = Field("Business"),
            ["requestType"] = Field("Type"),
            ["caseNumber"] = Field("Case#"),
            ["dateCreated"] = NormalizeDate(source["Date Created"]),
            ["sector"] = Field("Sector"),
            ["division"] = Field("Division"),
            ["unitName"] = Field("Unit Name"),
            ["unitNumber"] = Field("Unit Number"),
            ["vendor"] = Field("Vendor"),
            ["din"] = Field("DIN"),
            ["min"] = Field("MIN"),
            ["manufacturer"] = Field("Manufacturer"),
            ["brand"] = Field("Brand"),
            ["description"] = Field("Description"),
            ["parentCategory"] = Field("Parent Category"),
            ["subCategory"] = Field("Sub Category"),
            ["usageQty"] = NumberField("Usage"),
            ["oneTimeOrPermanent"] = Field("One-Time or Permanent"),
            ["reasonForRequest"] = Field("Reason for request"),
            ["dpl"] = Field("DPL"),
            ["meetsCriteria"] = PercentField("Meets Criteria"),
            ["inCat"] = Field("In CAT"),
            ["onMog"] = Field("On MOG"),
            ["pantry"] = Field("Pantry"),
            ["k12Apl"] = Field("K12 APL"),
            ["compassApl"] = Field("Compass APL"),
            ["conversionDin"] = Field("Conversion DIN"),
            ["conversionVaPct"] = PercentField("Conversion VA%"),
            ["upstreamAction"] = NormalizeAction(source["ACTION"]),
            ["upstreamIfInStockAction"] = NormalizeAction(source["If In Stock: Action"]),
            ["upstreamBuysmartAction"] = NormalizeAction(source["Buysmart Action"])
        };

        string Lower(string name) => CleanText(fields[name]).ToLowerInvariant();
        var actionKey = NormalizeKey(fields["upstreamAction"]);
        var buysmartKey = NormalizeKey(fields["upstreamBuysmartAction"]);
        var requestTypeKey = NormalizeKey(fields["requestType"]);
        var businessKey = NormalizeKey(fields["business"]);
        var compassApl = Lower("compassApl");
        var pantry = Lower("pantry");
        var division = Lower("division");
        var inCat = Lower("inCat");
        var meetsCriteria = DecimalValue(fields["meetsCriteria"]);

        var derived = new JsonObject
        {
            ["business_key"] = businessKey,
            ["request_type_key"] = requestTypeKey,
            ["is_compass"] = businessKey.Contains("COMPASS USA"),
            ["is_canada"] = businessKey.Contains("COMPASS CANADA"),
            ["is_healthtrust"] = businessKey.Contains("HEALTHTRUST"),
            ["is_hmshost"] = businessKey.Contains("HMSHOST"),
            ["is_foodbuyone"] = businessKey.Contains("FOODBUYONE"),
            ["is_mass_add"] = requestTypeKey == "MASS ADDS",
            ["is_mass_srf"] = requestTypeKey == "MASS ADDS SRF",
            ["is_prf"] = requestTypeKey == "PRF",
            ["is_sorf"] = requestTypeKey == "SORF",
            ["is_srf"] = requestTypeKey == "SRF",
            ["is_one_time"] = OneTimeRegex().IsMatch(CleanText(fields["oneTimeOrPermanent"])),
            ["is_permanent"] = PermanentRegex().IsMatch(CleanText(fields["oneTimeOrPermanent"])),
            ["usage_num"] = DecimalValue(fields["usageQty"]),
            ["meets_criteria_num"] = meetsCriteria,
            ["meets_criteria_ge_10"] = meetsCriteria is not null && meetsCriteria >= 0.1m,
            ["in_cat_key"] = NormalizeKey(fields["inCat"]),
            ["is_in_cat_y"] = string.Equals(CleanText(fields["inCat"]), "Y", StringComparison.OrdinalIgnoreCase),
            ["is_temp_available"] = inCat.Contains("temp available") || inCat == "ta",
            ["is_in_catalog"] = string.Equals(CleanText(fields["inCat"]), "Y", StringComparison.OrdinalIgnoreCase) || inCat.Contains("temp available"),
            ["is_pantry"] = pantry.Contains("item") || pantry.Contains("subcategory") || pantry == "y",
            ["is_k12_apl"] = string.Equals(CleanText(fields["k12Apl"]), "Y", StringComparison.OrdinalIgnoreCase),
            ["is_core_apl"] = compassApl.Contains("core apl"),
            ["is_s1"] = S1Regex().IsMatch(CleanText(fields["compassApl"])),
            ["is_foh"] = compassApl.Contains("front of house") || FohRegex().IsMatch(CleanText(fields["compassApl"])),
            ["is_diverse"] = compassApl.Contains("diverse"),
            ["has_conversion"] = CleanText(fields["conversionDin"]) != "",
            ["upstream_action_key"] = actionKey,
            ["current_action_key"] = actionKey,
            ["current_buysmart_key"] = buysmartKey,
            ["brand_lc"] = Lower("brand"),
            ["manufacturer_lc"] = Lower("manufacturer"),
            ["description_lc"] = Lower("description"),
            ["subcategory_lc"] = Lower("subCategory"),
            ["parent_category_lc"] = Lower("parentCategory"),
            ["division_lc"] = division,
            ["sector_lc"] = Lower("sector"),
            ["reason_lc"] = Lower("reasonForRequest"),
            ["vendor_lc"] = Lower("vendor"),
            ["din_lc"] = Lower("din"),
            ["min_lc"] = Lower("min"),
            ["is_levy"] = Lower("sector").Contains("levy") || division.Contains("levy"),
            ["is_schools"] = division.Contains("school") || division.Contains("chartwells")
        };

        return new JsonObject { ["source"] = source, ["fields"] = fields, ["derived"] = derived };
    }

    public static JsonObject CollapseRawRow(JsonObject rawRow)
    {
        var collapsed = new JsonObject();
        foreach (var item in rawRow)
        {
            var header = CanonicalHeader(item.Key);
            if (!collapsed.ContainsKey(header) || string.IsNullOrWhiteSpace(CleanText(collapsed[header])))
            {
                collapsed[header] = item.Value?.DeepClone();
            }
        }
        return collapsed;
    }

    public static string CleanText(object? value)
    {
        if (value is null) return "";
        if (value is JsonNode node)
        {
            if (node.GetValueKind() == System.Text.Json.JsonValueKind.Null) return "";
            if (node.GetValueKind() == System.Text.Json.JsonValueKind.String) return node.GetValue<string>().Trim();
            if (node is JsonValue) return node.ToString().Trim();
        }
        return string.Join(' ', value.ToString()?.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries) ?? []).Trim();
    }

    public static string NormalizeAction(object? value)
    {
        var text = CleanText(value);
        if (text == "") return "";
        if (string.Equals(text, "ok", StringComparison.OrdinalIgnoreCase)) return "OK";
        if (string.Equals(text, "approved", StringComparison.OrdinalIgnoreCase)) return "Approved";
        if (Approved1XRegex().IsMatch(text)) return "Approved - 1X";
        if (string.Equals(text, "blank", StringComparison.OrdinalIgnoreCase)) return "";
        return text;
    }

    public static string NormalizeKey(object? value) =>
        NonAlphaNumericRegex().Replace(CleanText(value).ToUpperInvariant(), " ").Trim();

    public static decimal? DecimalValue(JsonNode? value) => ParseNumber(value);

    public static string QueueBucketForType(string requestType)
    {
        var key = NormalizeKey(requestType);
        if (key.Contains("PRF")) return "PRF Processing";
        if (key.Contains("SORF")) return "SORF Processing";
        if (key.Contains("SRF")) return "SRF Processing";
        return "Assigned for Processing";
    }

    public static string AppendText(string existing, string value)
    {
        if (string.IsNullOrWhiteSpace(value)) return existing;
        return string.IsNullOrWhiteSpace(existing) ? value : $"{existing}; {value}";
    }

    private static string CanonicalHeader(string header)
    {
        var raw = string.Join(' ', header.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries));
        var key = raw.ToLowerInvariant().Replace("_", " ").Replace("-", " ").Trim();
        return key switch
        {
            "case #" or "case" => "Case#",
            "subcategory" or "sub category" => "Sub Category",
            "buy smart action" or "buysmartaction" => "Buysmart Action",
            "if in-stock action" or "if in stock action" => "If In Stock: Action",
            "dstdin" => "DSTDIN",
            _ => raw
        };
    }

    private static decimal? ParseNumber(JsonNode? value)
    {
        var text = CleanText(value).Replace(",", "").Replace("%", "").Trim();
        if (text == "" || string.Equals(text, "blank", StringComparison.OrdinalIgnoreCase)) return null;
        return decimal.TryParse(text, NumberStyles.Any, CultureInfo.InvariantCulture, out var parsed) ? parsed : null;
    }

    private static string NormalizeDate(JsonNode? value)
    {
        var text = CleanText(value);
        return DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var parsed) ? parsed.ToString("O") : text;
    }

    [GeneratedRegex("one-time|one time|seasonal", RegexOptions.IgnoreCase)]
    private static partial Regex OneTimeRegex();
    [GeneratedRegex("permanent", RegexOptions.IgnoreCase)]
    private static partial Regex PermanentRegex();
    [GeneratedRegex("\\bs1\\b", RegexOptions.IgnoreCase)]
    private static partial Regex S1Regex();
    [GeneratedRegex("\\bfoh\\b", RegexOptions.IgnoreCase)]
    private static partial Regex FohRegex();
    [GeneratedRegex("^approved\\s*-\\s*1x$", RegexOptions.IgnoreCase)]
    private static partial Regex Approved1XRegex();
    [GeneratedRegex("[^A-Z0-9]+")]
    private static partial Regex NonAlphaNumericRegex();
}
