using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using ClosedXML.Excel;
using Dapper;
using Npgsql;

var builder = WebApplication.CreateBuilder(args);
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    options.SerializerOptions.DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull;
});

builder.Services.AddCors(options =>
{
    var origins = builder.Configuration["AllowedOrigins"] ?? "*";
    options.AddDefaultPolicy(policy =>
    {
        if (origins == "*")
        {
            policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod();
        }
        else
        {
            policy.WithOrigins(origins.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                .AllowAnyHeader()
                .AllowAnyMethod();
        }
    });
});
builder.Services.AddSingleton<ComplianceStore>();

var app = builder.Build();
app.UseCors();

app.MapGet("/api/health", async (ComplianceStore store) =>
{
    var configured = store.IsConfigured;
    var ruleCount = configured ? await store.RuleCountAsync() : 0;
    var readyCount = configured ? await store.ReadyVariantCountAsync() : 0;
    return Results.Ok(new
    {
        ok = configured,
        store = configured ? "neon" : "memory",
        databaseConfigured = configured,
        defaultDafWorkbook = false,
        defaultSourceWorkbook = false,
        rulesSeeded = ruleCount > 0,
        ruleCount,
        executableVariantCount = readyCount,
        timestamp = DateTimeOffset.UtcNow
    });
});

app.MapGet("/api/routes", () => Results.Ok(RouteManifest.Current));

app.MapPost("/api/bootstrap", async (ComplianceStore store) =>
{
    await store.BootstrapAsync();
    return Results.Ok(new
    {
        ok = true,
        statements = Migrations.Statements.Length,
        rulesSeeded = await store.RuleCountAsync() > 0,
        ruleCount = await store.RuleCountAsync(),
        executableVariantCount = await store.ReadyVariantCountAsync()
    });
});

app.MapGet("/api/batches", async (ComplianceStore store) =>
    Results.Ok(new { batches = await store.ListBatchesAsync() }));

app.MapPost("/api/batches/upload", async (ComplianceStore store, UploadWorkbookRequest request) =>
{
    var bytes = PayloadBytes(request.FileBase64);
    var parsed = WorkbookParser.ParseSourceWorkbook(request.FileName, bytes);
    var batchId = Guid.NewGuid();
    var now = DateTimeOffset.UtcNow;
    var batch = new SourceBatch
    {
        Id = batchId,
        Name = string.IsNullOrWhiteSpace(request.Name) ? "Daily PRF/SORF/SRF" : request.Name,
        SourceKind = "upload",
        ReportingDate = string.IsNullOrWhiteSpace(request.ReportingDate) ? DateOnly.FromDateTime(DateTime.UtcNow).ToString("MM/dd/yyyy", CultureInfo.InvariantCulture) : request.ReportingDate,
        Status = "draft",
        RowCount = parsed.Rows.Count,
        SourceFileName = parsed.FileName,
        SourceSheetName = parsed.SheetName,
        FileSha256 = Sha256(bytes),
        CreatedAt = now,
        UpdatedAt = now
    };
    var rows = parsed.Rows.Select((row, index) => Normalizer.CreateWorkflowRow(batchId, row, index + 2, now)).ToList();
    await store.CreateBatchAsync(batch, rows);
    return Results.Ok(new { batchId, rowCount = rows.Count, warnings = parsed.Warnings });
});

app.MapPost("/api/batches/sample", () =>
    Results.Problem("Sample workbook loading is a local TypeScript convenience. Upload a workbook through /api/batches/upload for the .NET API.", statusCode: 501));

app.MapGet("/api/batches/{batchId:guid}", async (ComplianceStore store, Guid batchId) =>
{
    var batch = await store.GetBatchAsync(batchId);
    return batch is null ? Results.NotFound(new { error = "Batch not found." }) : Results.Ok(new { batch });
});

app.MapDelete("/api/batches/{batchId:guid}", async (ComplianceStore store, Guid batchId) =>
{
    var archived = await store.ArchiveBatchAsync(batchId);
    return archived ? Results.Ok(new { archived = true }) : Results.NotFound(new { error = "Batch not found." });
});

app.MapGet("/api/batches/{batchId:guid}/rows", async (ComplianceStore store, Guid batchId, HttpRequest request) =>
{
    var rows = await store.GetRowsAsync(batchId);
    return Results.Ok(RowFilters.Apply(rows, request.Query));
});

app.MapGet("/api/batches/{batchId:guid}/summary", async (ComplianceStore store, Guid batchId) =>
{
    var rows = await store.GetRowsAsync(batchId);
    return Results.Ok(RuleEngine.SummarizeBatch(rows));
});

app.MapPost("/api/batches/{batchId:guid}/export", async (ComplianceStore store, Guid batchId, ExportRequest request) =>
{
    var rows = await store.GetRowsAsync(batchId);
    if (request.Format?.Equals("xlsx", StringComparison.OrdinalIgnoreCase) == true)
    {
        var bytes = WorkbookParser.ExportRows(rows);
        return Results.File(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"rules-engine-{batchId}.xlsx");
    }
    var csv = WorkbookParser.ExportCsv(rows);
    return Results.Text(csv, "text/csv");
});

app.MapPatch("/api/rows/{rowId:guid}", async (ComplianceStore store, Guid rowId, JsonObject patch) =>
{
    var row = await store.UpdateRowAsync(rowId, patch);
    return row is null ? Results.NotFound(new { error = "Row not found." }) : Results.Ok(new { row });
});

app.MapGet("/api/rules", async (ComplianceStore store) =>
    Results.Ok(new { rules = await store.ListRulesAsync() }));

app.MapPost("/api/rules", async (ComplianceStore store, RuleCreateRequest request) =>
{
    var rules = await store.ListRulesAsync();
    var rule = RuleEditor.CreateUserRule(request, rules);
    rules.Add(rule);
    await store.ReplaceRuleCatalogAsync(rules);
    await store.AuditAsync("rule.created", "rule_definition", rule.Id, new JsonObject { ["ruleId"] = rule.RuleId, ["name"] = rule.Name });
    return Results.Created($"/api/rules/{rule.RuleId}", new { rule, rules = await store.ListRulesAsync() });
});

app.MapPost("/api/rules/seed", async (ComplianceStore store, SeedRequest request) =>
{
    var rules = await store.ListRulesAsync();
    return Results.Ok(new { rules, seeded = rules.Count > 0, report = RuleEditor.ReportFromRules(rules) });
});

app.MapPost("/api/rules/import-daf", async (ComplianceStore store) =>
{
    var rules = await store.ListRulesAsync();
    return Results.Ok(new { rules, report = RuleEditor.ReportFromRules(rules) });
});

app.MapPatch("/api/rules/{ruleId}", async (ComplianceStore store, string ruleId, JsonObject body) =>
{
    var rules = await store.ListRulesAsync();
    var index = rules.FindIndex(rule => rule.RuleId.Equals(ruleId, StringComparison.OrdinalIgnoreCase));
    if (index < 0) return Results.NotFound(new { error = "Rule not found." });

    if (RuleEditor.HasEditPayload(body))
    {
        var request = body.Deserialize<RuleCreateRequest>(JsonDefaults.Options) ?? new RuleCreateRequest();
        rules[index] = RuleEditor.UpdateRule(rules[index], request);
    }
    else if (body.TryGetPropertyValue("enabled", out var enabledNode))
    {
        rules[index] = RuleEditor.SetEnabled(rules[index], enabledNode?.GetValue<bool>() ?? false);
    }
    else
    {
        return Results.BadRequest(new { error = "Send rule fields or enabled status to update." });
    }

    await store.ReplaceRuleCatalogAsync(rules);
    await store.AuditAsync("rule.updated", "rule_definition", rules[index].Id, new JsonObject { ["ruleId"] = rules[index].RuleId });
    return Results.Ok(new { rule = rules[index], rules = await store.ListRulesAsync() });
});

app.MapDelete("/api/rules/{ruleId}", async (ComplianceStore store, string ruleId) =>
{
    if (RuleEditor.IsBundledRuleId(ruleId)) return Results.Conflict(new { error = "Bundled rules can be disabled, but not removed." });
    var rules = await store.ListRulesAsync();
    var rule = rules.FirstOrDefault(item => item.RuleId.Equals(ruleId, StringComparison.OrdinalIgnoreCase));
    if (rule is null) return Results.NotFound(new { error = "Rule not found." });
    await store.ReplaceRuleCatalogAsync(rules.Where(item => !item.RuleId.Equals(ruleId, StringComparison.OrdinalIgnoreCase)).ToList());
    await store.AuditAsync("rule.archived", "rule_definition", rule.Id, new JsonObject { ["ruleId"] = rule.RuleId });
    return Results.Ok(new { archived = true, rules = await store.ListRulesAsync() });
});

app.MapGet("/api/rules/{ruleId}", async (ComplianceStore store, string ruleId) =>
{
    var rule = (await store.ListRulesAsync()).FirstOrDefault(item => item.RuleId.Equals(ruleId, StringComparison.OrdinalIgnoreCase));
    return rule is null ? Results.NotFound(new { error = "Rule not found." }) : Results.Ok(new { rule });
});

app.MapPost("/api/rules/{ruleId}/versions", async (ComplianceStore store, string ruleId) =>
{
    var rules = await store.ListRulesAsync();
    var rule = rules.FirstOrDefault(item => item.RuleId.Equals(ruleId, StringComparison.OrdinalIgnoreCase));
    if (rule is null) return Results.NotFound(new { error = "Rule not found." });
    rule.VersionId = Guid.NewGuid();
    rule.VersionNumber += 1;
    rule.Status = "draft";
    rule.AutomationLevel = "guided";
    rule.UpdatedAt = DateTimeOffset.UtcNow;
    foreach (var variant in rule.Variants)
    {
        variant.Id = Guid.NewGuid();
        variant.RuleVersionId = rule.VersionId;
        variant.Status = "draft";
        variant.Enabled = false;
    }
    await store.ReplaceRuleCatalogAsync(rules);
    return Results.Ok(new { rule });
});

app.MapPatch("/api/rules/versions/{versionId:guid}", async (ComplianceStore store, Guid versionId, JsonObject patch) =>
{
    var rules = await store.ListRulesAsync();
    var rule = rules.FirstOrDefault(item => item.VersionId == versionId);
    if (rule is null) return Results.NotFound(new { error = "Rule version not found." });
    if (patch.TryGetPropertyValue("status", out var status)) rule.Status = Text(status);
    if (patch.TryGetPropertyValue("automationLevel", out var automation)) rule.AutomationLevel = Text(automation);
    if (patch.TryGetPropertyValue("notes", out var notes)) rule.Notes = Text(notes);
    rule.UpdatedAt = DateTimeOffset.UtcNow;
    await store.ReplaceRuleCatalogAsync(rules);
    return Results.Ok(new { rule });
});

app.MapPost("/api/rules/versions/{versionId:guid}/approve", async (ComplianceStore store, Guid versionId) =>
{
    var rules = await store.ListRulesAsync();
    var rule = rules.FirstOrDefault(item => item.VersionId == versionId);
    if (rule is null) return Results.NotFound(new { error = "Rule version not found." });
    rule.Status = "approved";
    rule.AutomationLevel = RuleEditor.AggregateAutomation(rule.Variants);
    foreach (var variant in rule.Variants.Where(variant => variant.IsExecutable))
    {
        variant.Status = "approved";
        variant.Enabled = true;
    }
    await store.ReplaceRuleCatalogAsync(rules);
    return Results.Ok(new { rule });
});

app.MapPost("/api/rules/variants/{variantId:guid}/test", async (ComplianceStore store, Guid variantId, VariantTestRequest request) =>
{
    var variant = (await store.ListRulesAsync()).SelectMany(rule => rule.Variants).FirstOrDefault(item => item.Id == variantId);
    if (variant is null) return Results.NotFound(new { error = "Variant not found." });
    var row = request.Row is not null
        ? request.Row
        : Normalizer.CreateWorkflowRow(Guid.NewGuid(), request.Sample ?? new JsonObject(), 1, DateTimeOffset.UtcNow);
    return Results.Ok(new { before = row, after = RuleEngine.ExecuteRow(row, new[] { variant }) });
});

app.MapPost("/api/rules/simulate", async (ComplianceStore store, SimulateRequest request) =>
{
    var rules = await store.ListRulesAsync();
    var row = request.Row ?? Normalizer.CreateWorkflowRow(Guid.NewGuid(), request.Sample ?? new JsonObject(), 1, DateTimeOffset.UtcNow);
    return Results.Ok(new { before = row, after = RuleEngine.ExecuteRow(row, RuleEngine.ExecutableVariants(rules)) });
});

app.MapPost("/api/runs", async (ComplianceStore store, RunRequest request) =>
{
    var beforeRows = await store.GetRowsAsync(request.BatchId);
    var rules = await store.ListRulesAsync();
    var result = RuleEngine.ExecuteRows(beforeRows, rules, request.RowIds);
    var run = new RuleRun
    {
        Id = Guid.NewGuid(),
        BatchId = request.BatchId,
        Status = "completed",
        RunMode = string.IsNullOrWhiteSpace(request.Mode) ? "full_batch" : request.Mode,
        RuleVersionSnapshot = RuleEngine.CatalogSnapshot(rules),
        InputRowCount = beforeRows.Count,
        ChangedRowCount = result.ChangedCount,
        ReviewRowCount = result.ReviewCount,
        StartedAt = DateTimeOffset.UtcNow,
        CompletedAt = DateTimeOffset.UtcNow
    };
    var executionResults = RuleEngine.CreateResults(run.Id, beforeRows, result.Rows, request.RowIds);
    if (!request.DryRun) await store.CreateRunAsync(run, executionResults, result.Rows);
    return Results.Ok(new { run, results = executionResults, dryRun = request.DryRun });
});

app.MapGet("/api/runs/{runId:guid}", async (ComplianceStore store, Guid runId) =>
{
    var run = await store.GetRunAsync(runId);
    return run is null ? Results.NotFound(new { error = "Run not found." }) : Results.Ok(new { run });
});

app.MapGet("/api/runs/{runId:guid}/results", async (ComplianceStore store, Guid runId) =>
    Results.Ok(new { results = await store.ListRunResultsAsync(runId) }));

app.Run();

static byte[] PayloadBytes(string? fileBase64)
{
    if (string.IsNullOrWhiteSpace(fileBase64)) return Array.Empty<byte>();
    var payload = fileBase64.Contains(',') ? fileBase64[(fileBase64.IndexOf(',') + 1)..] : fileBase64;
    return Convert.FromBase64String(payload);
}

static string Sha256(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
static string Text(JsonNode? node) => node is null ? "" : node.GetValueKind() == JsonValueKind.String ? node.GetValue<string>() : node.ToJsonString();

static class JsonDefaults
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
    };
}

static class RouteManifest
{
    public static object Current => new
    {
        frontendRoutes = new[]
        {
            new { path = "/", label = "Compliance Rules", purpose = "Rules readiness, recent batches, and processing entry point." },
            new { path = "/upload", label = "Process PRF", purpose = "Upload a PRF/SORF/SRF workbook, run saved rules, and show result buckets." },
            new { path = "/execute", label = "Execution Console", purpose = "Optional run console for selected batches." },
            new { path = "/workbench", label = "Analyst Workbench", purpose = "Search, filter, review, and edit workflow row decisions." },
            new { path = "/reports", label = "Buckets", purpose = "Compliance bucket rollups, drilldowns, coverage, and CSV/XLSX export." },
            new { path = "/rules", label = "Rule Catalog", purpose = "Browse and manage saved compliance rules." },
            new { path = "/settings", label = "System", purpose = "Current operating status and workflow links." }
        },
        apiRoutes = new[]
        {
            new { method = "GET", path = "/api/health", purpose = "Rule engine status and saved rule readiness." },
            new { method = "GET", path = "/api/routes", purpose = "Frontend and API route manifest." },
            new { method = "POST", path = "/api/bootstrap", purpose = "Create storage tables and indexes." },
            new { method = "GET", path = "/api/batches", purpose = "List source batches." },
            new { method = "POST", path = "/api/batches/upload", purpose = "Upload a PRF/SORF/SRF workbook as base64 JSON." },
            new { method = "GET", path = "/api/batches/:batchId", purpose = "Batch metadata." },
            new { method = "DELETE", path = "/api/batches/:batchId", purpose = "Archive a batch." },
            new { method = "GET", path = "/api/batches/:batchId/rows", purpose = "Paginated/filterable workflow rows." },
            new { method = "GET", path = "/api/batches/:batchId/summary", purpose = "Batch KPI, compliance buckets, and chart-ready summary." },
            new { method = "POST", path = "/api/batches/:batchId/export", purpose = "Export CSV or XLSX outcomes." },
            new { method = "PATCH", path = "/api/rows/:rowId", purpose = "Patch analyst-editable row fields." },
            new { method = "GET", path = "/api/rules", purpose = "List saved rule definitions." },
            new { method = "POST", path = "/api/rules", purpose = "Create a user-managed compliance rule." },
            new { method = "PATCH", path = "/api/rules/:ruleId", purpose = "Enable, disable, or update a saved rule." },
            new { method = "DELETE", path = "/api/rules/:ruleId", purpose = "Archive a user-managed rule." },
            new { method = "POST", path = "/api/rules/seed", purpose = "Return saved rule catalog status." },
            new { method = "POST", path = "/api/rules/import-daf", purpose = "Return saved rule catalog status." },
            new { method = "GET", path = "/api/rules/:ruleId", purpose = "Rule details, version, and variants." },
            new { method = "POST", path = "/api/rules/:ruleId/versions", purpose = "Create a draft version from the current rule." },
            new { method = "PATCH", path = "/api/rules/versions/:versionId", purpose = "Edit version metadata." },
            new { method = "POST", path = "/api/rules/versions/:versionId/approve", purpose = "Approve a rule version for execution." },
            new { method = "POST", path = "/api/rules/variants/:variantId/test", purpose = "Test one variant against a row or raw sample." },
            new { method = "POST", path = "/api/rules/simulate", purpose = "Run rules against one row without persisting." },
            new { method = "POST", path = "/api/runs", purpose = "Execute approved rule variants against a batch." },
            new { method = "GET", path = "/api/runs/:runId", purpose = "Run metadata and counts." },
            new { method = "GET", path = "/api/runs/:runId/results", purpose = "Row-level before/after execution trace results." }
        }
    };
}

