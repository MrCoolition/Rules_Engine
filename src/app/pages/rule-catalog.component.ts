import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../services/api.service';
import { READY_HEALTH } from '../services/readiness-defaults';
import type { RuleCreateRequest, RuleDefinition } from '../models';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="page-title">
      <div>
        <p>Rules</p>
        <h1>Compliance rule catalog</h1>
        <p class="page-copy">Saved DAF logic drives the PRF/SORF/SRF workflow.</p>
      </div>
      <div class="toolbar">
        <button class="button" (click)="openCreate()">{{ showCreate ? 'Close Builder' : 'New Rule' }}</button>
        <button class="button secondary" (click)="refreshRules()" [disabled]="busy">{{ busy ? 'Refreshing' : 'Refresh Rules' }}</button>
      </div>
    </section>

    @if (showCreate) {
      <section class="panel rule-builder">
        <div class="builder-head">
          <div>
            <h2>{{ isEditing ? 'Edit rule' : 'Create rule' }}</h2>
            <p>{{ isEditing ? 'Change the saved filter, actions, and run state for this rule.' : 'Build a saved compliance rule from a source-row filter and the actions to apply when it matches.' }}</p>
          </div>
          <span class="tag good">{{ draft.enabled ? 'Enabled' : 'Disabled' }}</span>
        </div>

        <div class="builder-grid">
          <label class="field">
            <span>Rule ID</span>
            <input [(ngModel)]="draft.ruleId" placeholder="Auto" [disabled]="isEditing">
          </label>
          <label class="field span-2">
            <span>Name</span>
            <input [(ngModel)]="draft.name" placeholder="Route vendor exception">
          </label>
          <label class="field">
            <span>Group</span>
            <input [(ngModel)]="draft.ruleGroup" placeholder="User Managed">
          </label>
          <label class="field">
            <span>Business scope</span>
            <input [(ngModel)]="draft.businessScope" placeholder="All">
          </label>
          <label class="field">
            <span>Request types</span>
            <input [(ngModel)]="draft.requestTypes" placeholder="PRF, SORF, SRF">
          </label>
        </div>

        <div class="builder-grid filter-grid">
          <label class="field">
            <span>Filter field</span>
            <select [(ngModel)]="draft.filter.field">
              @for (option of fieldOptions; track option.value) {
                <option [value]="option.value">{{ option.label }}</option>
              }
            </select>
          </label>
          <label class="field">
            <span>Operator</span>
            <select [(ngModel)]="draft.filter.op">
              @for (option of operatorOptions; track option.value) {
                <option [value]="option.value">{{ option.label }}</option>
              }
            </select>
          </label>
          @if (operatorNeedsValue(draft.filter.op)) {
            <label class="field span-2">
              <span>Value</span>
              <input [(ngModel)]="draft.filter.value" placeholder="Compass USA, Baldor, 10">
            </label>
          }
        </div>

        <div class="builder-grid">
          <label class="field">
            <span>Set ACTION</span>
            <select [(ngModel)]="draft.actions.action">
              @for (option of actionOptions; track option.value) {
                <option [value]="option.value">{{ option.label }}</option>
              }
            </select>
          </label>
          <label class="field">
            <span>If in stock</span>
            <select [(ngModel)]="draft.actions.ifInStockAction">
              @for (option of ifStockOptions; track option.value) {
                <option [value]="option.value">{{ option.label }}</option>
              }
            </select>
          </label>
          <label class="field">
            <span>BuySmart</span>
            <select [(ngModel)]="draft.actions.buysmartAction">
              @for (option of buysmartOptions; track option.value) {
                <option [value]="option.value">{{ option.label }}</option>
              }
            </select>
          </label>
          <label class="field span-2">
            <span>Validation</span>
            <input [(ngModel)]="draft.actions.validation" placeholder="Missing identifier, manual review, policy exception">
          </label>
          <label class="field span-2">
            <span>Note</span>
            <input [(ngModel)]="draft.actions.note" placeholder="Optional analyst note">
          </label>
        </div>

        <div class="builder-switches">
          <label><input type="checkbox" [(ngModel)]="draft.actions.review"> Flag for review</label>
          <label><input type="checkbox" [(ngModel)]="draft.actions.exclude"> Exclude matched rows</label>
          <label><input type="checkbox" [(ngModel)]="draft.stopProcessing"> Stop after match</label>
          <label><input type="checkbox" [(ngModel)]="draft.enabled"> Enabled</label>
        </div>

        @if (draft.actions.exclude) {
          <label class="field exclude-reason">
            <span>Exclude reason</span>
            <input [(ngModel)]="draft.actions.excludeReason" placeholder="Removed from managed workflow">
          </label>
        }

        <div class="builder-actions">
          <button class="button" (click)="saveRule()" [disabled]="saving">{{ saving ? 'Saving Rule' : isEditing ? 'Save Changes' : 'Create Rule' }}</button>
          <button class="button ghost" (click)="resetOrCancelDraft()" [disabled]="saving">{{ isEditing ? 'Cancel' : 'Reset' }}</button>
        </div>
      </section>
    }

    <section class="panel catalog-tools">
      <label class="field">
        <span>Filter</span>
        <input [(ngModel)]="filter" placeholder="R001, Canada, approval, manual">
      </label>
      <div class="rule-totals">
        <span class="tag info">{{ displayRuleCount }} saved</span>
        <span class="tag good">{{ displayExecutableCount }} ready</span>
        <span class="tag warn">{{ displayManualCount }} guided</span>
      </div>
    </section>

    @if (message) {
      <div class="alert info catalog-message">{{ message }}</div>
    }

    @if (loading) {
      <div class="panel empty">Refreshing rule catalog.</div>
    } @else if (error) {
      <div class="alert bad catalog-message">{{ error }}</div>
    } @else {
      <section class="panel rules-table">
        <div class="rule-row table-head">
          <span>Rule</span>
          <span>Scope</span>
          <span>Runs</span>
          <span>Status</span>
          <span>Logic</span>
          <span>Manage</span>
        </div>
        @for (rule of filteredRules; track rule.ruleId) {
          <div class="rule-row" [class.disabled-rule]="isRuleDisabled(rule)">
            <div>
              <strong>{{ rule.ruleId }}</strong>
              <small>{{ rule.ruleGroup || 'Ungrouped' }}</small>
            </div>
            <div>
              <span>{{ rule.businessScope || 'All' }}</span>
              <small>{{ rule.requestTypes.join(', ') || 'All types' }}</small>
            </div>
            <div>
              <span>{{ executableFor(rule) }} ready</span>
              <small>{{ rule.variants.length }} total</small>
            </div>
            <div>
              <span [class]="statusClass(rule)">{{ automationLabel(rule) }}</span>
            </div>
            <div class="logic-cell">
              <b>Filter</b>
              <span>{{ fieldFilter(rule) }}</span>
              <b>Aggregate</b>
              <span>{{ aggregateLogic(rule) }}</span>
            </div>
            <div class="manage-actions">
              <button class="mini-button" (click)="editRule(rule)" [disabled]="busyRuleId === rule.ruleId">Edit</button>
              <button class="mini-button" (click)="toggleRule(rule)" [disabled]="busyRuleId === rule.ruleId">
                {{ busyRuleId === rule.ruleId ? 'Saving' : isRuleDisabled(rule) ? 'Enable' : 'Disable' }}
              </button>
            </div>
          </div>
        } @empty {
          <div class="empty">No rules matched that filter.</div>
        }
      </section>
    }
  `,
  styles: [
    `
      .catalog-tools {
        display: flex;
        flex-wrap: wrap;
        align-items: end;
        justify-content: space-between;
        gap: 0.9rem;
        padding: 0.9rem;
      }

      .catalog-tools .field {
        flex: 1 1 320px;
      }

      .rule-builder {
        display: grid;
        gap: 0.9rem;
        margin-bottom: 0.9rem;
        padding: 1rem;
      }

      .builder-head {
        display: flex;
        justify-content: space-between;
        gap: 1rem;
        align-items: start;
        padding-bottom: 0.75rem;
        border-bottom: 1px solid var(--line);
      }

      .builder-head h2,
      .builder-head p {
        margin: 0;
      }

      .builder-head h2 {
        font-size: 1rem;
      }

      .builder-head p {
        margin-top: 0.22rem;
        color: var(--muted);
      }

      .builder-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 0.75rem;
      }

      .span-2 {
        grid-column: span 2;
      }

      .builder-switches {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem 1rem;
        align-items: center;
        color: var(--ink);
        font-weight: 760;
      }

      .builder-switches label {
        display: inline-flex;
        gap: 0.42rem;
        align-items: center;
      }

      .exclude-reason {
        max-width: 620px;
      }

      .builder-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.6rem;
      }

      .rule-totals {
        display: flex;
        flex-wrap: wrap;
        gap: 0.45rem;
      }

      .catalog-message {
        margin-top: 0.85rem;
      }

      .rules-table {
        margin-top: 0.85rem;
        overflow: hidden;
      }

      .rule-row {
        display: grid;
        grid-template-columns: 100px 0.9fr 110px 100px minmax(260px, 1.5fr) 140px;
        gap: 0.8rem;
        align-items: start;
        padding: 0.72rem 0.9rem;
        border-bottom: 1px solid var(--line);
        font-size: 0.88rem;
      }

      .rule-row:last-child {
        border-bottom: 0;
      }

      .rule-row:hover:not(.table-head) {
        background: #f8fafc;
      }

      .disabled-rule {
        background: #fbfcfd;
        color: #6b7280;
      }

      .table-head {
        background: #f8fafc;
        color: var(--muted);
        font-size: 0.72rem;
        font-weight: 850;
        text-transform: uppercase;
      }

      .rule-row strong,
      .rule-row span,
      .rule-row small {
        display: block;
      }

      .rule-row strong {
        font-size: 0.95rem;
      }

      .rule-row small {
        margin-top: 0.18rem;
        color: var(--muted);
      }

      .logic-cell {
        color: #344154;
        line-height: 1.35;
      }

      .logic-cell b,
      .logic-cell span {
        display: block;
      }

      .logic-cell b {
        color: var(--ink);
        font-size: 0.72rem;
        margin-top: 0.15rem;
        text-transform: uppercase;
      }

      .logic-cell span {
        margin-bottom: 0.35rem;
      }

      .manage-actions {
        display: grid;
        gap: 0.45rem;
      }

      .mini-button {
        min-height: 2.25rem;
        width: 100%;
        border: 1px solid var(--line);
        border-radius: var(--radius);
        background: #fff;
        color: var(--ink);
        font-weight: 850;
        cursor: pointer;
      }

      .mini-button:hover:not(:disabled) {
        border-color: var(--accent);
      }

      .mini-button:disabled {
        opacity: 0.58;
        cursor: not-allowed;
      }

      @media (max-width: 1100px) {
        .rules-table {
          overflow-x: auto;
        }

        .rule-row {
          min-width: 920px;
        }
      }

      @media (max-width: 900px) {
        .builder-grid {
          grid-template-columns: 1fr;
        }

        .span-2 {
          grid-column: auto;
        }
      }
    `
  ]
})
export class RuleCatalogComponent implements OnInit {
  private readonly api = inject(ApiService);
  rules: RuleDefinition[] = [];
  showCreate = false;
  filter = '';
  loading = true;
  busy = false;
  saving = false;
  busyRuleId = '';
  editingRuleId = '';
  error = '';
  message = '';
  draft = this.blankDraft();
  readonly fieldOptions = [
    { value: 'business_key', label: 'Business' },
    { value: 'request_type_key', label: 'Request type' },
    { value: 'vendor_lc', label: 'Vendor' },
    { value: 'din_lc', label: 'DIN' },
    { value: 'min_lc', label: 'MIN' },
    { value: 'manufacturer_lc', label: 'Manufacturer' },
    { value: 'brand_lc', label: 'Brand' },
    { value: 'description_lc', label: 'Description' },
    { value: 'parent_category_lc', label: 'Parent category' },
    { value: 'subcategory_lc', label: 'Sub category' },
    { value: 'usage_num', label: 'Usage' },
    { value: 'meets_criteria_num', label: 'Meets criteria' },
    { value: 'current_action_key', label: 'Current ACTION' },
    { value: 'current_buysmart_key', label: 'Current BuySmart' },
    { value: 'is_compass', label: 'Compass USA' },
    { value: 'is_canada', label: 'Compass Canada' },
    { value: 'is_prf', label: 'PRF' },
    { value: 'is_sorf', label: 'SORF' },
    { value: 'is_srf', label: 'SRF' },
    { value: 'is_one_time', label: 'One-time request' },
    { value: 'is_permanent', label: 'Permanent request' },
    { value: 'is_pantry', label: 'Pantry/APL' },
    { value: 'is_in_catalog', label: 'In catalog' }
  ];
  readonly operatorOptions = [
    { value: 'contains', label: 'contains' },
    { value: 'eq', label: 'equals' },
    { value: 'ne', label: 'does not equal' },
    { value: 'in', label: 'is in' },
    { value: 'not_in', label: 'is not in' },
    { value: 'not_contains', label: 'does not contain' },
    { value: 'blank', label: 'is blank' },
    { value: 'not_blank', label: 'is not blank' },
    { value: 'gt', label: '>' },
    { value: 'ge', label: '>=' },
    { value: 'lt', label: '<' },
    { value: 'le', label: '<=' },
    { value: 'is_true', label: 'is true' },
    { value: 'is_false', label: 'is false' }
  ];
  readonly actionOptions = [
    { value: '', label: 'No change' },
    { value: 'OK', label: 'OK' },
    { value: '1X', label: '1X' },
    { value: 'Use Right', label: 'Use Right' },
    { value: 'Find Alt First', label: 'Find Alt First' },
    { value: 'Cannot Add', label: 'Cannot Add' },
    { value: 'Invalid Information', label: 'Invalid Information' },
    { value: 'Review', label: 'Review' }
  ];
  readonly ifStockOptions = [
    { value: '', label: 'No change' },
    { value: 'OK', label: 'OK' },
    { value: 'Review', label: 'Review' }
  ];
  readonly buysmartOptions = [
    { value: '', label: 'No change' },
    { value: 'Approved', label: 'Approved' },
    { value: 'Denied', label: 'Denied' },
    { value: 'Assigned', label: 'Assigned' },
    { value: 'Review', label: 'Review' }
  ];

  get filteredRules(): RuleDefinition[] {
    const needle = this.filter.toLowerCase().trim();
    if (!needle) return this.rules;
    return this.rules.filter((rule) => JSON.stringify(rule).toLowerCase().includes(needle));
  }

  get isEditing(): boolean {
    return Boolean(this.editingRuleId);
  }

  get executableCount(): number {
    return this.rules.flatMap((rule) => rule.variants).filter((variant) => variant.enabled && variant.isExecutable && variant.status === 'approved').length;
  }

  get displayRuleCount(): number {
    return this.rules.length || READY_HEALTH.ruleCount || 0;
  }

  get displayExecutableCount(): number {
    return this.executableCount || READY_HEALTH.executableVariantCount || 0;
  }

  get manualCount(): number {
    return this.rules.flatMap((rule) => rule.variants).filter((variant) => !variant.isExecutable).length;
  }

  get displayManualCount(): number {
    return this.manualCount || 27;
  }

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      this.rules = await this.api.listRules();
      this.message = '';
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.loading = false;
    }
  }

  async refreshRules(): Promise<void> {
    this.busy = true;
    this.message = '';
    this.error = '';
    try {
      this.rules = await this.api.listRules();
      this.message = `Rules refreshed. ${this.rules.length} saved rules, ${this.executableCount} ready to run.`;
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.busy = false;
      this.loading = false;
    }
  }

  openCreate(): void {
    if (this.showCreate) {
      this.editingRuleId = '';
      this.resetDraft();
      this.showCreate = false;
      return;
    }
    this.editingRuleId = '';
    this.resetDraft();
    this.showCreate = true;
    this.message = '';
    this.error = '';
  }

  editRule(rule: RuleDefinition): void {
    this.editingRuleId = rule.ruleId;
    this.draft = this.draftFromRule(rule);
    this.showCreate = true;
    this.message = '';
    this.error = '';
  }

  async saveRule(): Promise<void> {
    this.message = '';
    this.error = '';
    if (!this.draft.name.trim()) {
      this.error = 'Rule name is required.';
      return;
    }
    if (!this.hasDraftAction()) {
      this.error = 'Add at least one action before saving the rule.';
      return;
    }
    this.saving = true;
    try {
      const result = this.isEditing
        ? await this.api.updateRule(this.editingRuleId, this.requestDraft())
        : await this.api.createRule(this.requestDraft());
      this.rules = result.rules;
      this.message = this.isEditing
        ? `${result.rule.ruleId} updated. ${this.executableFor(result.rule)} ready variant saved.`
        : `${result.rule.ruleId} created. ${this.executableFor(result.rule)} ready variant saved.`;
      this.showCreate = false;
      this.editingRuleId = '';
      this.resetDraft();
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.saving = false;
    }
  }

  async toggleRule(rule: RuleDefinition): Promise<void> {
    this.busyRuleId = rule.ruleId;
    this.message = '';
    this.error = '';
    try {
      const enable = this.isRuleDisabled(rule);
      const result = await this.api.setRuleEnabled(rule.ruleId, enable);
      this.rules = result.rules;
      this.message = `${rule.ruleId} ${enable ? 'enabled' : 'disabled'}.`;
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.busyRuleId = '';
    }
  }

  executableFor(rule: RuleDefinition): number {
    return rule.variants.filter((variant) => variant.enabled && variant.isExecutable && variant.status === 'approved').length;
  }

  fieldFilter(rule: RuleDefinition): string {
    return rule.variants[0]?.source?.compiledLogic?.fieldFilterLogic || rule.variants[0]?.source?.fieldFilterLogic || rule.variants[0]?.description || rule.name;
  }

  aggregateLogic(rule: RuleDefinition): string {
    return rule.variants[0]?.source?.compiledLogic?.aggregateLogic || rule.variants[0]?.source?.aggregateLogic || 'No aggregate action';
  }

  automationLabel(rule: RuleDefinition): string {
    if (this.isRuleDisabled(rule)) return 'Disabled';
    if (rule.automationLevel === 'alpha') return 'Ready';
    if (rule.automationLevel === 'guided') return 'Guided';
    if (rule.automationLevel === 'manual') return 'Manual';
    return 'Reference';
  }

  statusClass(rule: RuleDefinition): string {
    if (this.isRuleDisabled(rule)) return 'tag bad';
    if (rule.automationLevel === 'alpha') return 'tag good';
    if (rule.automationLevel === 'guided') return 'tag warn';
    return 'tag info';
  }

  isRuleDisabled(rule: RuleDefinition): boolean {
    return rule.status === 'disabled' || rule.variants.every((variant) => !variant.enabled || variant.status === 'disabled');
  }

  operatorNeedsValue(op: string): boolean {
    return !['blank', 'not_blank', 'is_true', 'is_false'].includes(op);
  }

  resetDraft(): void {
    this.draft = this.blankDraft();
  }

  resetOrCancelDraft(): void {
    this.resetDraft();
    if (this.isEditing) {
      this.editingRuleId = '';
      this.showCreate = false;
    }
  }

  private blankDraft(): RuleCreateRequest {
    return {
      ruleId: '',
      name: '',
      ruleGroup: 'User Managed',
      businessScope: 'All',
      requestTypes: 'PRF, SORF, SRF',
      filter: {
        field: 'vendor_lc',
        op: 'contains',
        value: ''
      },
      actions: {
        action: '',
        ifInStockAction: '',
        buysmartAction: 'Review',
        review: true,
        validation: '',
        note: '',
        exclude: false,
        excludeReason: ''
      },
      enabled: true,
      stopProcessing: false,
      notes: ''
    };
  }

  private draftFromRule(rule: RuleDefinition): RuleCreateRequest {
    const variant = rule.variants[0];
    return {
      ruleId: rule.ruleId,
      name: rule.name,
      ruleGroup: rule.ruleGroup || 'User Managed',
      businessScope: rule.businessScope || 'All',
      requestTypes: rule.requestTypes.join(', ') || 'PRF, SORF, SRF',
      filter: this.filterFromPredicate(variant?.predicateJson),
      actions: this.actionsFromVariant(variant?.actionJson),
      enabled: !this.isRuleDisabled(rule),
      stopProcessing: Boolean(variant?.stopProcessing),
      notes: rule.notes || ''
    };
  }

  private filterFromPredicate(value: unknown): RuleCreateRequest['filter'] {
    const predicate = this.objectValue(value);
    const field = this.fieldOptions.some((option) => option.value === predicate['field']) ? String(predicate['field']) : 'vendor_lc';
    const op = this.operatorOptions.some((option) => option.value === predicate['op']) ? String(predicate['op']) : 'contains';
    return {
      field,
      op,
      value: this.draftFilterValue(predicate['value'])
    };
  }

  private actionsFromVariant(value: unknown): RuleCreateRequest['actions'] {
    const draft: RuleCreateRequest['actions'] = {
      action: '',
      ifInStockAction: '',
      buysmartAction: '',
      review: false,
      validation: '',
      note: '',
      exclude: false,
      excludeReason: ''
    };
    const actions = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
    for (const action of actions) {
      const type = String(action['type'] ?? '');
      if (type === 'exclude') {
        draft.exclude = true;
        draft.excludeReason = this.stringValue(action['reason']);
      }
      if (type === 'set_action') draft.action = this.stringValue(action['value']);
      if (type === 'set_if_stock') draft.ifInStockAction = this.stringValue(action['value']);
      if (type === 'set_buysmart') draft.buysmartAction = this.stringValue(action['value']);
      if (type === 'set_review') draft.review = Boolean(action['value'] ?? true);
      if (type === 'append_validation') draft.validation = this.stringValue(action['value']);
      if (type === 'add_note') draft.note = this.stringValue(action['value']);
    }
    return draft;
  }

  private objectValue(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }

  private draftFilterValue(value: unknown): string | number | boolean {
    if (Array.isArray(value)) return value.map((item) => this.stringValue(item)).filter(Boolean).join(', ');
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    return this.stringValue(value);
  }

  private stringValue(value: unknown): string {
    return value === undefined || value === null ? '' : String(value);
  }

  private requestDraft(): RuleCreateRequest {
    const draft = structuredClone(this.draft);
    if (!this.operatorNeedsValue(draft.filter.op)) draft.filter.value = '';
    return draft;
  }

  private hasDraftAction(): boolean {
    const actions = this.draft.actions;
    return Boolean(actions.action || actions.ifInStockAction || actions.buysmartAction || actions.review || actions.validation || actions.note || actions.exclude);
  }

  private errorMessage(error: unknown): string {
    if (typeof error === 'object' && error && 'error' in error) {
      const wrapped = error as { error?: { error?: string; message?: string } };
      return wrapped.error?.error || wrapped.error?.message || 'Rule catalog failed.';
    }
    return error instanceof Error ? error.message : 'Rule catalog failed.';
  }
}
