using System.Text.Json.Nodes;

public sealed class SourceBatch
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public string SourceKind { get; set; } = "upload";
    public string ReportingDate { get; set; } = "";
    public string Status { get; set; } = "draft";
    public int RowCount { get; set; }
    public string SourceFileName { get; set; } = "";
    public string SourceSheetName { get; set; } = "";
    public string FileSha256 { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public object? Summary { get; set; }
}

public sealed class WorkflowRow
{
    public Guid Id { get; set; }
    public Guid BatchId { get; set; }
    public int SourceRowNumber { get; set; }
    public string WorkflowRequestKey { get; set; } = "";
    public JsonObject RawRow { get; set; } = new();
    public JsonObject NormalizedRow { get; set; } = new();
    public string Business { get; set; } = "";
    public string RequestType { get; set; } = "";
    public string CaseNumber { get; set; } = "";
    public string DateCreated { get; set; } = "";
    public string Sector { get; set; } = "";
    public string Division { get; set; } = "";
    public string UnitName { get; set; } = "";
    public string UnitNumber { get; set; } = "";
    public string Vendor { get; set; } = "";
    public string Din { get; set; } = "";
    public string Min { get; set; } = "";
    public string Manufacturer { get; set; } = "";
    public string Brand { get; set; } = "";
    public string Description { get; set; } = "";
    public string ParentCategory { get; set; } = "";
    public string SubCategory { get; set; } = "";
    public decimal? UsageQty { get; set; }
    public string OneTimeOrPermanent { get; set; } = "";
    public string ReasonForRequest { get; set; } = "";
    public string Dpl { get; set; } = "";
    public decimal? MeetsCriteria { get; set; }
    public string InCat { get; set; } = "";
    public string OnMog { get; set; } = "";
    public string Pantry { get; set; } = "";
    public string K12Apl { get; set; } = "";
    public string CompassApl { get; set; } = "";
    public string ConversionDin { get; set; } = "";
    public decimal? ConversionVaPct { get; set; }
    public string UpstreamAction { get; set; } = "";
    public string UpstreamIfInStockAction { get; set; } = "";
    public string Action { get; set; } = "";
    public string IfInStockAction { get; set; } = "";
    public string BuysmartAction { get; set; } = "";
    public string RuleApplied { get; set; } = "";
    public JsonArray ExecutionTrace { get; set; } = new();
    public bool NeedsReview { get; set; }
    public string AnalystNotes { get; set; } = "";
    public string ValidationStatus { get; set; } = "";
    public bool Excluded { get; set; }
    public string ExcludedReason { get; set; } = "";
    public string QueueBucket { get; set; } = "";
    public string RequestBucket { get; set; } = "";
    public string OutcomeReporting { get; set; } = "";
    public bool Selected { get; set; }
    public string Assignment { get; set; } = "";
    public string Status { get; set; } = "Ready";
    public string LastSyncAt { get; set; } = "";
    public string LastSavedAt { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public sealed class RuleDefinition
{
    public Guid Id { get; set; }
    public string RuleId { get; set; } = "";
    public string Name { get; set; } = "";
    public string RuleGroup { get; set; } = "";
    public string BusinessScope { get; set; } = "";
    public List<string> RequestTypes { get; set; } = [];
    public string DiscoveryReference { get; set; } = "";
    public string Notes { get; set; } = "";
    public string OwnerTeam { get; set; } = "";
    public Guid VersionId { get; set; }
    public int VersionNumber { get; set; }
    public string Status { get; set; } = "approved";
    public string AutomationLevel { get; set; } = "alpha";
    public List<RuleVariant> Variants { get; set; } = [];
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public sealed class RuleVariant
{
    public Guid Id { get; set; }
    public Guid RuleDefinitionId { get; set; }
    public Guid RuleVersionId { get; set; }
    public string RuleId { get; set; } = "";
    public string RuntimeRuleId { get; set; } = "";
    public string RuntimeKind { get; set; } = "row_rule";
    public int ExecutionPriority { get; set; }
    public bool Enabled { get; set; }
    public bool IsExecutable { get; set; }
    public bool StopProcessing { get; set; }
    public JsonObject? PredicateJson { get; set; }
    public JsonArray? ActionJson { get; set; }
    public string Description { get; set; } = "";
    public string AutomationLevel { get; set; } = "alpha";
    public string Status { get; set; } = "approved";
    public JsonObject Source { get; set; } = new();
    public DateTimeOffset CreatedAt { get; set; }
}

public sealed class RuleRun
{
    public Guid Id { get; set; }
    public Guid BatchId { get; set; }
    public string Status { get; set; } = "completed";
    public string RunMode { get; set; } = "full_batch";
    public JsonObject RuleVersionSnapshot { get; set; } = new();
    public int InputRowCount { get; set; }
    public int ChangedRowCount { get; set; }
    public int ReviewRowCount { get; set; }
    public string ErrorMessage { get; set; } = "";
    public DateTimeOffset StartedAt { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
}

public sealed class RowExecutionResult
{
    public Guid Id { get; set; }
    public Guid RunId { get; set; }
    public Guid WorkflowRowId { get; set; }
    public WorkflowRow BeforeState { get; set; } = new();
    public WorkflowRow AfterState { get; set; } = new();
    public JsonArray Trace { get; set; } = new();
    public JsonArray RulesApplied { get; set; } = new();
    public JsonArray Validations { get; set; } = new();
    public DateTimeOffset CreatedAt { get; set; }
}

public sealed class RuleCreateRequest
{
    public string? RuleId { get; set; }
    public string Name { get; set; } = "";
    public string RuleGroup { get; set; } = "User Managed";
    public string BusinessScope { get; set; } = "All";
    public string RequestTypes { get; set; } = "PRF, SORF, SRF";
    public FilterRequest Filter { get; set; } = new();
    public ActionRequest Actions { get; set; } = new();
    public bool Enabled { get; set; } = true;
    public bool StopProcessing { get; set; }
    public string Notes { get; set; } = "";
}

public sealed class FilterRequest
{
    public string Field { get; set; } = "vendor_lc";
    public string Op { get; set; } = "contains";
    public JsonNode? Value { get; set; }
}

public sealed class ActionRequest
{
    public string? Action { get; set; }
    public string? IfInStockAction { get; set; }
    public string? BuysmartAction { get; set; }
    public bool Review { get; set; }
    public string? Validation { get; set; }
    public string? Note { get; set; }
    public bool Exclude { get; set; }
    public string? ExcludeReason { get; set; }
}

public sealed record UploadWorkbookRequest(string FileName, string FileBase64, string ReportingDate, string Name);
public sealed record ExportRequest(string? Format);
public sealed record SeedRequest(bool Force);
public sealed record RunRequest(Guid BatchId, string? Mode, bool DryRun, List<Guid>? RowIds);
public sealed record VariantTestRequest(WorkflowRow? Row, JsonObject? Sample);
public sealed record SimulateRequest(WorkflowRow? Row, JsonObject? Sample);
public sealed record ParsedWorkbook(string FileName, string SheetName, List<string> Columns, List<JsonObject> Rows, List<string> Warnings);
public sealed record ExecuteRowsResult(List<WorkflowRow> Rows, int ChangedCount, int ReviewCount);

