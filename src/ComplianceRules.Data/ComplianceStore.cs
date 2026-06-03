using System.Text.Json;
using System.Text.Json.Nodes;
using Dapper;
using Microsoft.Extensions.Configuration;
using Npgsql;

public sealed class ComplianceStore
{
    private readonly string? _connectionString;

    public ComplianceStore(IConfiguration configuration)
    {
        _connectionString = NormalizeConnectionString(
            configuration["DATABASE_URL"] ??
            Environment.GetEnvironmentVariable("DATABASE_URL") ??
            Environment.GetEnvironmentVariable("POSTGRES_URL") ??
            Environment.GetEnvironmentVariable("POSTGRES_URL_NON_POOLING") ??
            Environment.GetEnvironmentVariable("DATABASE_URL_UNPOOLED"));
    }

    public bool IsConfigured => !string.IsNullOrWhiteSpace(_connectionString);

    public async Task BootstrapAsync()
    {
        await using var connection = await OpenAsync();
        foreach (var statement in Migrations.Statements) await connection.ExecuteAsync(statement);
    }

    public async Task<RuleSeedCatalog> EnsureSeededAsync(bool force = false)
    {
        await BootstrapAsync();
        var existingRules = force ? new List<RuleDefinition>() : await ListRulesAsync();
        if (!force && existingRules.Count > 0)
        {
            return new RuleSeedCatalog(existingRules, RuleEditor.ReportFromRules(existingRules));
        }

        var seed = DafSeedCatalog.Build();
        await ReplaceRuleCatalogAsync(seed.Rules);
        await AuditAsync(
            force ? "rules.reseeded" : "rules.seeded",
            "rule_catalog",
            null,
            JsonSerializer.SerializeToNode(seed.Report, JsonDefaults.Options) as JsonObject ?? new JsonObject());
        return seed;
    }

    public async Task<int> RuleCountAsync()
    {
        if (!IsConfigured) return 0;
        await using var connection = await OpenAsync();
        return await connection.ExecuteScalarAsync<int>("select count(*) from rule_definitions");
    }

    public async Task<int> ReadyVariantCountAsync()
    {
        if (!IsConfigured) return 0;
        await using var connection = await OpenAsync();
        return await connection.ExecuteScalarAsync<int>("select count(*) from rule_variants where enabled = true and is_executable = true and status = 'approved'");
    }

    public async Task<List<SourceBatch>> ListBatchesAsync()
    {
        await using var connection = await OpenAsync();
        var rows = await connection.QueryAsync("select * from source_batches where status <> 'archived' order by created_at desc");
        return rows.Select(row => ToBatch(Row((object)row))).ToList();
    }

    public async Task<SourceBatch?> GetBatchAsync(Guid batchId)
    {
        await using var connection = await OpenAsync();
        var row = await connection.QueryFirstOrDefaultAsync("select * from source_batches where id = @batchId limit 1", new { batchId });
        return row is null ? null : ToBatch(Row((object)row));
    }

    public async Task<bool> ArchiveBatchAsync(Guid batchId)
    {
        await using var connection = await OpenAsync();
        var count = await connection.ExecuteAsync("update source_batches set status = 'archived', updated_at = now() where id = @batchId", new { batchId });
        if (count > 0) await AuditAsync("batch.archived", "source_batch", batchId, new JsonObject());
        return count > 0;
    }

    public async Task CreateBatchAsync(SourceBatch batch, IReadOnlyList<WorkflowRow> rows)
    {
        await using var connection = await OpenAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        await connection.ExecuteAsync(
            """
            insert into source_batches
              (id, name, source_kind, reporting_date, status, row_count, source_file_name, source_sheet_name, file_sha256, created_at, updated_at)
            values
              (@Id, @Name, @SourceKind, @ReportingDate, @Status, @RowCount, @SourceFileName, @SourceSheetName, @FileSha256, @CreatedAt, @UpdatedAt)
            """,
            batch,
            transaction);
        foreach (var row in rows) await UpsertRowAsync(connection, transaction, row);
        await transaction.CommitAsync();
    }

    public async Task<List<WorkflowRow>> GetRowsAsync(Guid batchId)
    {
        await using var connection = await OpenAsync();
        var rows = await connection.QueryAsync("select * from workflow_rows where batch_id = @batchId order by source_row_number asc", new { batchId });
        return rows.Select(row => ToWorkflowRow(Row((object)row))).ToList();
    }

    public async Task ReplaceRowsAsync(Guid batchId, IReadOnlyList<WorkflowRow> rows)
    {
        await using var connection = await OpenAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        foreach (var row in rows) await UpsertRowAsync(connection, transaction, row);
        await connection.ExecuteAsync("update source_batches set status = 'processed', updated_at = now() where id = @batchId", new { batchId }, transaction);
        await transaction.CommitAsync();
    }

    public async Task<WorkflowRow?> UpdateRowAsync(Guid rowId, JsonObject patch)
    {
        await using var connection = await OpenAsync();
        var current = await connection.QueryFirstOrDefaultAsync("select * from workflow_rows where id = @rowId limit 1", new { rowId });
        if (current is null) return null;
        var before = ToWorkflowRow(Row((object)current));
        var after = RuleEngine.ApplyRowPatch(before, patch);
        await using var transaction = await connection.BeginTransactionAsync();
        await UpsertRowAsync(connection, transaction, after);
        foreach (var key in patch.Select(item => item.Key))
        {
            await connection.ExecuteAsync(
                """
                insert into analyst_overrides (id, workflow_row_id, field_name, old_value, new_value, reason, created_at)
                values (@id, @rowId, @key, '', '', 'Analyst edit', now())
                """,
                new { id = Guid.NewGuid(), rowId, key },
                transaction);
        }
        await transaction.CommitAsync();
        await AuditAsync("row.updated", "workflow_row", rowId, new JsonObject { ["fields"] = new JsonArray(patch.Select(item => JsonValue.Create(item.Key)).ToArray()) });
        return after;
    }

    public async Task<List<RuleDefinition>> ListRulesAsync()
    {
        await using var connection = await OpenAsync();
        var definitions = (await connection.QueryAsync(
            """
            select d.*, v.id as version_id, v.version_number, v.status as version_status, v.automation_level as version_automation_level
            from rule_definitions d
            join rule_versions v on v.rule_definition_id = d.id
            order by d.rule_id
            """)).Select(row => Row((object)row)).ToList();
        var variants = (await connection.QueryAsync(
            """
            select rv.*, v.rule_definition_id, d.rule_id
            from rule_variants rv
            join rule_versions v on v.id = rv.rule_version_id
            join rule_definitions d on d.id = v.rule_definition_id
            order by rv.execution_priority
            """)).Select(row => Row((object)row)).ToList();
        return definitions.Select(row => ToRuleDefinition(row, variants.Where(variant => GuidValue(variant, "rule_definition_id") == GuidValue(row, "id")).ToList())).ToList();
    }

    public async Task ReplaceRuleCatalogAsync(IReadOnlyList<RuleDefinition> rules)
    {
        await using var connection = await OpenAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        await connection.ExecuteAsync("delete from rule_definitions", transaction: transaction);
        foreach (var rule in rules)
        {
            await connection.ExecuteAsync(
                """
                insert into rule_definitions
                  (id, rule_id, name, rule_group, business_scope, request_types, discovery_reference, notes, owner_team, created_at, updated_at)
                values
                  (@Id, @RuleId, @Name, @RuleGroup, @BusinessScope, @RequestTypes::jsonb, @DiscoveryReference, @Notes, @OwnerTeam, @CreatedAt, @UpdatedAt)
                """,
                new
                {
                    rule.Id,
                    rule.RuleId,
                    rule.Name,
                    rule.RuleGroup,
                    rule.BusinessScope,
                    RequestTypes = JsonSerializer.Serialize(rule.RequestTypes, JsonDefaults.Options),
                    rule.DiscoveryReference,
                    rule.Notes,
                    rule.OwnerTeam,
                    rule.CreatedAt,
                    rule.UpdatedAt
                },
                transaction);
            await connection.ExecuteAsync(
                """
                insert into rule_versions
                  (id, rule_definition_id, version_number, status, automation_level, change_reason, created_at)
                values
                  (@VersionId, @RuleId, @VersionNumber, @Status, @AutomationLevel, 'Managed by .NET API', @CreatedAt)
                """,
                new
                {
                    rule.VersionId,
                    RuleId = rule.Id,
                    rule.VersionNumber,
                    rule.Status,
                    rule.AutomationLevel,
                    rule.CreatedAt
                },
                transaction);
            foreach (var variant in rule.Variants)
            {
                await connection.ExecuteAsync(
                    """
                    insert into rule_variants
                      (id, rule_version_id, runtime_rule_id, runtime_kind, execution_priority, enabled, is_executable,
                       stop_processing, predicate_json, action_json, description, automation_level, status, source, created_at)
                    values
                      (@Id, @RuleVersionId, @RuntimeRuleId, @RuntimeKind, @ExecutionPriority, @Enabled, @IsExecutable,
                       @StopProcessing, @PredicateJson::jsonb, @ActionJson::jsonb, @Description, @AutomationLevel, @Status, @Source::jsonb, @CreatedAt)
                    """,
                    new
                    {
                        variant.Id,
                        RuleVersionId = rule.VersionId,
                        variant.RuntimeRuleId,
                        variant.RuntimeKind,
                        variant.ExecutionPriority,
                        variant.Enabled,
                        variant.IsExecutable,
                        variant.StopProcessing,
                        PredicateJson = variant.PredicateJson?.ToJsonString(JsonDefaults.Options) ?? "null",
                        ActionJson = variant.ActionJson?.ToJsonString(JsonDefaults.Options) ?? "null",
                        variant.Description,
                        variant.AutomationLevel,
                        variant.Status,
                        Source = variant.Source.ToJsonString(JsonDefaults.Options),
                        CreatedAt = variant.CreatedAt == default ? rule.CreatedAt : variant.CreatedAt
                    },
                    transaction);
            }
        }
        await transaction.CommitAsync();
    }

    public async Task CreateRunAsync(RuleRun run, IReadOnlyList<RowExecutionResult> results, IReadOnlyList<WorkflowRow> rows)
    {
        await using var connection = await OpenAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        await connection.ExecuteAsync(
            """
            insert into rule_runs
              (id, batch_id, status, run_mode, rule_version_snapshot, input_row_count, changed_row_count, review_row_count, error_message, started_at, completed_at)
            values
              (@Id, @BatchId, @Status, @RunMode, @Snapshot::jsonb, @InputRowCount, @ChangedRowCount, @ReviewRowCount, @ErrorMessage, @StartedAt, @CompletedAt)
            """,
            new
            {
                run.Id,
                run.BatchId,
                run.Status,
                run.RunMode,
                Snapshot = run.RuleVersionSnapshot.ToJsonString(JsonDefaults.Options),
                run.InputRowCount,
                run.ChangedRowCount,
                run.ReviewRowCount,
                run.ErrorMessage,
                run.StartedAt,
                run.CompletedAt
            },
            transaction);
        foreach (var result in results)
        {
            await connection.ExecuteAsync(
                """
                insert into row_execution_results
                  (id, run_id, workflow_row_id, before_state, after_state, trace, rules_applied, validations, created_at)
                values
                  (@Id, @RunId, @WorkflowRowId, @BeforeState::jsonb, @AfterState::jsonb, @Trace::jsonb, @RulesApplied::jsonb, @Validations::jsonb, @CreatedAt)
                on conflict (run_id, workflow_row_id) do update set
                  before_state = excluded.before_state,
                  after_state = excluded.after_state,
                  trace = excluded.trace,
                  rules_applied = excluded.rules_applied,
                  validations = excluded.validations
                """,
                new
                {
                    result.Id,
                    result.RunId,
                    result.WorkflowRowId,
                    BeforeState = JsonSerializer.Serialize(result.BeforeState, JsonDefaults.Options),
                    AfterState = JsonSerializer.Serialize(result.AfterState, JsonDefaults.Options),
                    Trace = result.Trace.ToJsonString(JsonDefaults.Options),
                    RulesApplied = result.RulesApplied.ToJsonString(JsonDefaults.Options),
                    Validations = result.Validations.ToJsonString(JsonDefaults.Options),
                    result.CreatedAt
                },
                transaction);
        }
        foreach (var row in rows) await UpsertRowAsync(connection, transaction, row);
        await connection.ExecuteAsync("update source_batches set status = 'processed', updated_at = now() where id = @batchId", new { batchId = run.BatchId }, transaction);
        await transaction.CommitAsync();
    }

    public async Task<RuleRun?> GetRunAsync(Guid runId)
    {
        await using var connection = await OpenAsync();
        var row = await connection.QueryFirstOrDefaultAsync("select * from rule_runs where id = @runId limit 1", new { runId });
        return row is null ? null : ToRuleRun(Row((object)row));
    }

    public async Task<List<RowExecutionResult>> ListRunResultsAsync(Guid runId)
    {
        await using var connection = await OpenAsync();
        var rows = await connection.QueryAsync("select * from row_execution_results where run_id = @runId order by created_at", new { runId });
        return rows.Select(row => ToRowExecutionResult(Row((object)row))).ToList();
    }

    public async Task AuditAsync(string eventType, string entityType, Guid? entityId, JsonObject payload)
    {
        await using var connection = await OpenAsync();
        await connection.ExecuteAsync(
            "insert into audit_events (id, event_type, entity_type, entity_id, payload, created_at) values (@id, @eventType, @entityType, @entityId, @payload::jsonb, now())",
            new { id = Guid.NewGuid(), eventType, entityType, entityId, payload = payload.ToJsonString(JsonDefaults.Options) });
    }

    private async Task<NpgsqlConnection> OpenAsync()
    {
        if (!IsConfigured) throw new InvalidOperationException("Storage connection is required.");
        var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        return connection;
    }

    private static async Task UpsertRowAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, WorkflowRow row)
    {
        await connection.ExecuteAsync(
            """
            insert into workflow_rows (
              id, batch_id, source_row_number, workflow_request_key, raw_row, normalized_row, business, request_type, case_number,
              date_created, sector, division, unit_name, unit_number, vendor, din, min, manufacturer, brand, description,
              parent_category, sub_category, usage_qty, one_time_or_permanent, reason_for_request, dpl, meets_criteria,
              in_cat, on_mog, pantry, k12_apl, compass_apl, conversion_din, conversion_va_pct, upstream_action,
              upstream_if_in_stock_action, action, if_in_stock_action, buysmart_action, rule_applied, execution_trace,
              needs_review, analyst_notes, validation_status, excluded, excluded_reason, queue_bucket, request_bucket,
              outcome_reporting, selected, assignment, status, last_sync_at, last_saved_at, created_at, updated_at
            ) values (
              @Id, @BatchId, @SourceRowNumber, @WorkflowRequestKey, @RawRow::jsonb, @NormalizedRow::jsonb, @Business, @RequestType, @CaseNumber,
              @DateCreated, @Sector, @Division, @UnitName, @UnitNumber, @Vendor, @Din, @Min, @Manufacturer, @Brand, @Description,
              @ParentCategory, @SubCategory, @UsageQty, @OneTimeOrPermanent, @ReasonForRequest, @Dpl, @MeetsCriteria,
              @InCat, @OnMog, @Pantry, @K12Apl, @CompassApl, @ConversionDin, @ConversionVaPct, @UpstreamAction,
              @UpstreamIfInStockAction, @Action, @IfInStockAction, @BuysmartAction, @RuleApplied, @ExecutionTrace::jsonb,
              @NeedsReview, @AnalystNotes, @ValidationStatus, @Excluded, @ExcludedReason, @QueueBucket, @RequestBucket,
              @OutcomeReporting, @Selected, @Assignment, @Status, @LastSyncAt, @LastSavedAt, @CreatedAt, @UpdatedAt
            )
            on conflict (batch_id, source_row_number) do update set
              raw_row = excluded.raw_row,
              normalized_row = excluded.normalized_row,
              business = excluded.business,
              request_type = excluded.request_type,
              action = excluded.action,
              if_in_stock_action = excluded.if_in_stock_action,
              buysmart_action = excluded.buysmart_action,
              rule_applied = excluded.rule_applied,
              execution_trace = excluded.execution_trace,
              needs_review = excluded.needs_review,
              analyst_notes = excluded.analyst_notes,
              validation_status = excluded.validation_status,
              excluded = excluded.excluded,
              excluded_reason = excluded.excluded_reason,
              queue_bucket = excluded.queue_bucket,
              request_bucket = excluded.request_bucket,
              outcome_reporting = excluded.outcome_reporting,
              selected = excluded.selected,
              assignment = excluded.assignment,
              status = excluded.status,
              last_sync_at = excluded.last_sync_at,
              last_saved_at = excluded.last_saved_at,
              updated_at = excluded.updated_at
            """,
            new
            {
                row.Id,
                row.BatchId,
                row.SourceRowNumber,
                row.WorkflowRequestKey,
                RawRow = row.RawRow.ToJsonString(JsonDefaults.Options),
                NormalizedRow = row.NormalizedRow.ToJsonString(JsonDefaults.Options),
                row.Business,
                row.RequestType,
                row.CaseNumber,
                row.DateCreated,
                row.Sector,
                row.Division,
                row.UnitName,
                row.UnitNumber,
                row.Vendor,
                row.Din,
                row.Min,
                row.Manufacturer,
                row.Brand,
                row.Description,
                row.ParentCategory,
                row.SubCategory,
                row.UsageQty,
                row.OneTimeOrPermanent,
                row.ReasonForRequest,
                row.Dpl,
                row.MeetsCriteria,
                row.InCat,
                row.OnMog,
                row.Pantry,
                row.K12Apl,
                row.CompassApl,
                row.ConversionDin,
                row.ConversionVaPct,
                row.UpstreamAction,
                row.UpstreamIfInStockAction,
                row.Action,
                row.IfInStockAction,
                row.BuysmartAction,
                row.RuleApplied,
                ExecutionTrace = row.ExecutionTrace.ToJsonString(JsonDefaults.Options),
                row.NeedsReview,
                row.AnalystNotes,
                row.ValidationStatus,
                row.Excluded,
                row.ExcludedReason,
                row.QueueBucket,
                row.RequestBucket,
                row.OutcomeReporting,
                row.Selected,
                row.Assignment,
                row.Status,
                row.LastSyncAt,
                row.LastSavedAt,
                row.CreatedAt,
                row.UpdatedAt
            },
            transaction);
    }

    private static SourceBatch ToBatch(IDictionary<string, object?> row) => new()
    {
        Id = GuidValue(row, "id"),
        Name = StringValue(row, "name"),
        SourceKind = StringValue(row, "source_kind"),
        ReportingDate = StringValue(row, "reporting_date"),
        Status = StringValue(row, "status"),
        RowCount = IntValue(row, "row_count"),
        SourceFileName = StringValue(row, "source_file_name"),
        SourceSheetName = StringValue(row, "source_sheet_name"),
        FileSha256 = StringValue(row, "file_sha256"),
        CreatedAt = DateValue(row, "created_at"),
        UpdatedAt = DateValue(row, "updated_at")
    };

    private static WorkflowRow ToWorkflowRow(IDictionary<string, object?> row) => new()
    {
        Id = GuidValue(row, "id"),
        BatchId = GuidValue(row, "batch_id"),
        SourceRowNumber = IntValue(row, "source_row_number"),
        WorkflowRequestKey = StringValue(row, "workflow_request_key"),
        RawRow = JsonObjectValue(row, "raw_row"),
        NormalizedRow = JsonObjectValue(row, "normalized_row"),
        Business = StringValue(row, "business"),
        RequestType = StringValue(row, "request_type"),
        CaseNumber = StringValue(row, "case_number"),
        DateCreated = StringValue(row, "date_created"),
        Sector = StringValue(row, "sector"),
        Division = StringValue(row, "division"),
        UnitName = StringValue(row, "unit_name"),
        UnitNumber = StringValue(row, "unit_number"),
        Vendor = StringValue(row, "vendor"),
        Din = StringValue(row, "din"),
        Min = StringValue(row, "min"),
        Manufacturer = StringValue(row, "manufacturer"),
        Brand = StringValue(row, "brand"),
        Description = StringValue(row, "description"),
        ParentCategory = StringValue(row, "parent_category"),
        SubCategory = StringValue(row, "sub_category"),
        UsageQty = DecimalValue(row, "usage_qty"),
        OneTimeOrPermanent = StringValue(row, "one_time_or_permanent"),
        ReasonForRequest = StringValue(row, "reason_for_request"),
        Dpl = StringValue(row, "dpl"),
        MeetsCriteria = DecimalValue(row, "meets_criteria"),
        InCat = StringValue(row, "in_cat"),
        OnMog = StringValue(row, "on_mog"),
        Pantry = StringValue(row, "pantry"),
        K12Apl = StringValue(row, "k12_apl"),
        CompassApl = StringValue(row, "compass_apl"),
        ConversionDin = StringValue(row, "conversion_din"),
        ConversionVaPct = DecimalValue(row, "conversion_va_pct"),
        UpstreamAction = StringValue(row, "upstream_action"),
        UpstreamIfInStockAction = StringValue(row, "upstream_if_in_stock_action"),
        Action = StringValue(row, "action"),
        IfInStockAction = StringValue(row, "if_in_stock_action"),
        BuysmartAction = StringValue(row, "buysmart_action"),
        RuleApplied = StringValue(row, "rule_applied"),
        ExecutionTrace = JsonArrayValue(row, "execution_trace"),
        NeedsReview = BoolValue(row, "needs_review"),
        AnalystNotes = StringValue(row, "analyst_notes"),
        ValidationStatus = StringValue(row, "validation_status"),
        Excluded = BoolValue(row, "excluded"),
        ExcludedReason = StringValue(row, "excluded_reason"),
        QueueBucket = StringValue(row, "queue_bucket"),
        RequestBucket = StringValue(row, "request_bucket"),
        OutcomeReporting = StringValue(row, "outcome_reporting"),
        Selected = BoolValue(row, "selected"),
        Assignment = StringValue(row, "assignment"),
        Status = StringValue(row, "status"),
        LastSyncAt = StringValue(row, "last_sync_at"),
        LastSavedAt = StringValue(row, "last_saved_at"),
        CreatedAt = DateValue(row, "created_at"),
        UpdatedAt = DateValue(row, "updated_at")
    };

    private static RuleDefinition ToRuleDefinition(IDictionary<string, object?> row, IReadOnlyList<IDictionary<string, object?>> variants) => new()
    {
        Id = GuidValue(row, "id"),
        RuleId = StringValue(row, "rule_id"),
        Name = StringValue(row, "name"),
        RuleGroup = StringValue(row, "rule_group"),
        BusinessScope = StringValue(row, "business_scope"),
        RequestTypes = JsonArrayValue(row, "request_types").Select(Normalizer.CleanText).Where(value => value != "").ToList(),
        DiscoveryReference = StringValue(row, "discovery_reference"),
        Notes = StringValue(row, "notes"),
        OwnerTeam = StringValue(row, "owner_team"),
        VersionId = GuidValue(row, "version_id"),
        VersionNumber = IntValue(row, "version_number"),
        Status = StringValue(row, "version_status"),
        AutomationLevel = StringValue(row, "version_automation_level"),
        CreatedAt = DateValue(row, "created_at"),
        UpdatedAt = DateValue(row, "updated_at"),
        Variants = variants.Select(ToRuleVariant).ToList()
    };

    private static RuleVariant ToRuleVariant(IDictionary<string, object?> row) => new()
    {
        Id = GuidValue(row, "id"),
        RuleDefinitionId = GuidValue(row, "rule_definition_id"),
        RuleVersionId = GuidValue(row, "rule_version_id"),
        RuleId = StringValue(row, "rule_id"),
        RuntimeRuleId = StringValue(row, "runtime_rule_id"),
        RuntimeKind = StringValue(row, "runtime_kind"),
        ExecutionPriority = IntValue(row, "execution_priority"),
        Enabled = BoolValue(row, "enabled"),
        IsExecutable = BoolValue(row, "is_executable"),
        StopProcessing = BoolValue(row, "stop_processing"),
        PredicateJson = JsonObjectNullable(row, "predicate_json"),
        ActionJson = JsonArrayNullable(row, "action_json"),
        Description = StringValue(row, "description"),
        AutomationLevel = StringValue(row, "automation_level"),
        Status = StringValue(row, "status"),
        Source = JsonObjectValue(row, "source"),
        CreatedAt = DateValue(row, "created_at")
    };

    private static RuleRun ToRuleRun(IDictionary<string, object?> row) => new()
    {
        Id = GuidValue(row, "id"),
        BatchId = GuidValue(row, "batch_id"),
        Status = StringValue(row, "status"),
        RunMode = StringValue(row, "run_mode"),
        RuleVersionSnapshot = JsonObjectValue(row, "rule_version_snapshot"),
        InputRowCount = IntValue(row, "input_row_count"),
        ChangedRowCount = IntValue(row, "changed_row_count"),
        ReviewRowCount = IntValue(row, "review_row_count"),
        ErrorMessage = StringValue(row, "error_message"),
        StartedAt = DateValue(row, "started_at"),
        CompletedAt = NullableDateValue(row, "completed_at")
    };

    private static RowExecutionResult ToRowExecutionResult(IDictionary<string, object?> row) => new()
    {
        Id = GuidValue(row, "id"),
        RunId = GuidValue(row, "run_id"),
        WorkflowRowId = GuidValue(row, "workflow_row_id"),
        BeforeState = JsonSerializer.Deserialize<WorkflowRow>(StringValue(row, "before_state"), JsonDefaults.Options) ?? new WorkflowRow(),
        AfterState = JsonSerializer.Deserialize<WorkflowRow>(StringValue(row, "after_state"), JsonDefaults.Options) ?? new WorkflowRow(),
        Trace = JsonArrayValue(row, "trace"),
        RulesApplied = JsonArrayValue(row, "rules_applied"),
        Validations = JsonArrayValue(row, "validations"),
        CreatedAt = DateValue(row, "created_at")
    };

    private static string? NormalizeConnectionString(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        if (!raw.StartsWith("postgres://", StringComparison.OrdinalIgnoreCase) && !raw.StartsWith("postgresql://", StringComparison.OrdinalIgnoreCase)) return raw;
        var uri = new Uri(raw);
        var userInfo = uri.UserInfo.Split(':', 2);
        var builder = new NpgsqlConnectionStringBuilder
        {
            Host = uri.Host,
            Port = uri.Port > 0 ? uri.Port : 5432,
            Database = uri.AbsolutePath.TrimStart('/'),
            Username = Uri.UnescapeDataString(userInfo.ElementAtOrDefault(0) ?? ""),
            Password = Uri.UnescapeDataString(userInfo.ElementAtOrDefault(1) ?? ""),
            SslMode = SslMode.Require,
            Pooling = true
        };
        return builder.ConnectionString;
    }

    private static IDictionary<string, object?> Row(object row) => (IDictionary<string, object?>)row;
    private static object? Value(IDictionary<string, object?> row, string key) => row.TryGetValue(key, out var value) ? value : null;
    private static string StringValue(IDictionary<string, object?> row, string key) => Value(row, key)?.ToString() ?? "";
    private static Guid GuidValue(IDictionary<string, object?> row, string key) => Value(row, key) switch { Guid guid => guid, string text when Guid.TryParse(text, out var guid) => guid, _ => Guid.Empty };
    private static int IntValue(IDictionary<string, object?> row, string key) => Convert.ToInt32(Value(row, key) ?? 0);
    private static bool BoolValue(IDictionary<string, object?> row, string key) => Value(row, key) is bool b ? b : bool.TryParse(StringValue(row, key), out var parsed) && parsed;
    private static decimal? DecimalValue(IDictionary<string, object?> row, string key) => Value(row, key) is null ? null : Convert.ToDecimal(Value(row, key));
    private static DateTimeOffset DateValue(IDictionary<string, object?> row, string key) => Value(row, key) switch { DateTimeOffset dto => dto, DateTime dt => new DateTimeOffset(dt), string text when DateTimeOffset.TryParse(text, out var dto) => dto, _ => DateTimeOffset.UtcNow };
    private static DateTimeOffset? NullableDateValue(IDictionary<string, object?> row, string key) => Value(row, key) is null ? null : DateValue(row, key);
    private static JsonNode? JsonNodeValue(IDictionary<string, object?> row, string key) => string.IsNullOrWhiteSpace(StringValue(row, key)) ? null : JsonNode.Parse(StringValue(row, key));
    private static JsonObject JsonObjectValue(IDictionary<string, object?> row, string key) => JsonNodeValue(row, key) as JsonObject ?? new JsonObject();
    private static JsonArray JsonArrayValue(IDictionary<string, object?> row, string key) => JsonNodeValue(row, key) as JsonArray ?? new JsonArray();
    private static JsonObject? JsonObjectNullable(IDictionary<string, object?> row, string key) => JsonNodeValue(row, key) as JsonObject;
    private static JsonArray? JsonArrayNullable(IDictionary<string, object?> row, string key) => JsonNodeValue(row, key) as JsonArray;
}
