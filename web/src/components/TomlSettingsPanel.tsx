import { useEffect, useMemo, useState } from "react";
import { CheckCircle, EyeOff, Save, Settings2, SlidersHorizontal } from "lucide-react";
import type { AgentConfig } from "../lib/api";
import { updateAgentConfig, validateAgentConfig } from "../lib/api";
import {
  extractTomlEditableFields,
  setTomlFieldValue,
  type TomlEditableField,
} from "../lib/configToml";

interface TomlSettingsPanelProps {
  agentName: string;
  config: AgentConfig;
  onSaved: () => void;
}

export default function TomlSettingsPanel({
  agentName,
  config,
  onSaved,
}: TomlSettingsPanelProps) {
  const [draft, setDraft] = useState(config.content);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(config.content);
    setError(null);
  }, [config.content]);

  const fields = useMemo(
    () => extractTomlEditableFields(draft, config.format),
    [draft, config.format],
  );

  const grouped = useMemo(() => splitFieldGroups(fields), [fields]);
  if (fields.length === 0) return null;

  const dirty = draft !== config.content;

  return (
    <section className="rounded border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-accent" />
          <h3 className="text-[10px] font-medium uppercase tracking-wider text-text-muted">
            settings
          </h3>
        </div>
        <button
          onClick={async () => {
            try {
              setSaving(true);
              setError(null);
              const validation = await validateAgentConfig(agentName, draft);
              if (!validation.valid) {
                setError(validation.error || "configuration is invalid");
                return;
              }
              await updateAgentConfig(agentName, draft);
              setSaved(true);
              setTimeout(() => setSaved(false), 3000);
              onSaved();
            } catch (err) {
              setError(err instanceof Error ? err.message : "failed to save");
            } finally {
              setSaving(false);
            }
          }}
          disabled={!dirty || saving}
          className="flex items-center gap-1.5 rounded border border-border px-2.5 py-1 text-[10px] font-medium text-text-secondary transition-colors hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Save className="h-3 w-3" />
          {saving ? "saving..." : "save settings"}
        </button>
      </div>

      <div className="space-y-3">
        {grouped.common.map((group, index) => (
          <TomlFieldGroup
            key={group.section}
            group={group}
            disabled={saving}
            defaultOpen={index < 3}
            onChange={(field, value) => {
              setDraft((prev) =>
                setTomlFieldValue(prev, field.section, field.key, field.type, value),
              );
              setSaved(false);
              setError(null);
            }}
          />
        ))}

        {grouped.advanced.length > 0 && (
          <details className="rounded border border-border bg-bg">
            <summary className="flex cursor-pointer select-none items-center justify-between gap-3 px-3 py-2 text-xs font-semibold text-text-secondary transition-colors hover:text-text">
              <span className="flex items-center gap-2">
                <SlidersHorizontal className="h-3.5 w-3.5" />
                advanced
              </span>
              <span className="text-[10px] font-normal text-text-muted">
                {grouped.advancedFieldCount} fields
              </span>
            </summary>
            <div className="space-y-2 border-t border-border p-3">
              {grouped.advanced.map((group) => (
                <TomlFieldGroup
                  key={group.section}
                  group={group}
                  disabled={saving}
                  compact
                  onChange={(field, value) => {
                    setDraft((prev) =>
                      setTomlFieldValue(prev, field.section, field.key, field.type, value),
                    );
                    setSaved(false);
                    setError(null);
                  }}
                />
              ))}
            </div>
          </details>
        )}
      </div>

      {dirty && (
        <p className="mt-2 text-[10px] text-yellow">
          unsaved settings changes
        </p>
      )}
      {saved && (
        <p className="mt-2 flex items-center gap-1 text-[10px] text-green">
          <CheckCircle className="h-3 w-3" />
          saved — restart agent to apply
        </p>
      )}
      {error && <p className="mt-2 text-xs text-red">{error}</p>}
    </section>
  );
}

function TomlFieldGroup({
  group,
  disabled,
  defaultOpen = false,
  compact = false,
  onChange,
}: {
  group: TomlFieldGroup;
  disabled: boolean;
  defaultOpen?: boolean;
  compact?: boolean;
  onChange: (field: TomlEditableField, value: string | boolean) => void;
}) {
  return (
    <details
      className="rounded border border-border bg-bg"
      open={defaultOpen}
    >
      <summary className="flex cursor-pointer select-none items-center justify-between gap-3 px-3 py-2 text-xs font-semibold text-text-secondary transition-colors hover:text-text">
        <span>{group.label}</span>
        <span className="text-[10px] font-normal text-text-muted">
          {group.fields.length}
        </span>
      </summary>
      <div className={`grid gap-2 border-t border-border p-3 ${compact ? "lg:grid-cols-2" : "sm:grid-cols-2"}`}>
        {group.fields.map((field) => (
          <TomlFieldControl
            key={field.id}
            field={field}
            disabled={disabled}
            onChange={(value) => onChange(field, value)}
          />
        ))}
      </div>
    </details>
  );
}

function TomlFieldControl({
  field,
  disabled,
  onChange,
}: {
  field: TomlEditableField;
  disabled: boolean;
  onChange: (value: string | boolean) => void;
}) {
  const commonInputClass =
    "w-full rounded border border-border bg-surface px-2 py-1.5 text-xs text-text outline-none transition-colors focus:border-accent disabled:opacity-50";
  const valueIsLong =
    field.type === "expression" &&
    (field.rawValue.length > 80 || /^[\[{]/.test(field.rawValue.trim()));

  return (
    <label className="space-y-1">
      <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-text-muted">
        {field.sensitive && <EyeOff className="h-3 w-3" />}
        <span>{field.key}</span>
      </span>
      {field.type === "boolean" ? (
        <span className="flex h-8 items-center gap-2 rounded border border-border bg-surface px-2">
          <input
            type="checkbox"
            checked={field.value === "true"}
            disabled={disabled}
            onChange={(event) => onChange(event.target.checked)}
            className="h-4 w-4 rounded border-border bg-bg-subtle text-accent focus:ring-2 focus:ring-accent/50"
          />
          <span className="text-xs text-text-secondary">
            {field.value === "true" ? "enabled" : "disabled"}
          </span>
        </span>
      ) : field.sensitive ? (
        <input
          type="password"
          defaultValue=""
          disabled={disabled}
          autoComplete="off"
          placeholder={field.rawValue ? "stored value hidden" : ""}
          onChange={(event) => onChange(event.target.value)}
          className={commonInputClass}
        />
      ) : valueIsLong ? (
        <textarea
          value={field.value}
          disabled={disabled}
          rows={3}
          onChange={(event) => onChange(event.target.value)}
          className={`${commonInputClass} max-h-32 resize-y font-mono leading-relaxed`}
        />
      ) : (
        <input
          type={field.type === "number" ? "number" : "text"}
          value={field.value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className={commonInputClass}
        />
      )}
      {field.type === "expression" && (
        <span className="block text-[10px] text-text-muted">
          TOML value
        </span>
      )}
    </label>
  );
}

interface TomlFieldGroup {
  section: string;
  label: string;
  fields: TomlEditableField[];
}

function splitFieldGroups(fields: TomlEditableField[]): {
  common: TomlFieldGroup[];
  advanced: TomlFieldGroup[];
  advancedFieldCount: number;
} {
  const common = groupFields(fields.filter(isCommonField));
  const advanced = groupFields(fields.filter((field) => !isCommonField(field)));
  const advancedFieldCount = advanced.reduce(
    (sum, group) => sum + group.fields.length,
    0,
  );
  return { common, advanced, advancedFieldCount };
}

function groupFields(fields: TomlEditableField[]): TomlFieldGroup[] {
  const groups = new Map<string, TomlEditableField[]>();
  for (const field of fields) {
    const key = field.section || "general";
    groups.set(key, [...(groups.get(key) ?? []), field]);
  }

  return Array.from(groups.entries())
    .map(([section, groupFields]) => ({
      section,
      label: formatSectionLabel(section),
      fields: groupFields,
    }))
    .sort((a, b) => sectionRank(a.section) - sectionRank(b.section));
}

function isCommonField(field: TomlEditableField): boolean {
  if (field.sensitive) return false;
  if (field.type === "expression" && field.rawValue.length > 180) return false;

  const keys = commonKeysForSection(field.section);
  return keys.has(field.key);
}

function commonKeysForSection(section: string): Set<string> {
  if (section.startsWith("providers.models.")) {
    return keySet(["model", "temperature", "timeout_secs", "max_tokens", "base_url"]);
  }
  if (section.startsWith("channels.")) {
    return keySet([
      "approval_timeout_secs",
      "draft_update_interval_ms",
      "interrupt_on_new_message",
      "listen_to_bots",
      "mention_only",
      "multi_message_delay_ms",
      "stall_timeout_secs",
      "stream_mode",
    ]);
  }

  return COMMON_SECTION_KEYS[section] ?? EMPTY_KEY_SET;
}

function formatSectionLabel(section: string): string {
  if (!section) return "general";
  if (section.startsWith("providers.models.")) {
    return section.replace("providers.models.", "provider / ");
  }
  if (section.startsWith("channels.")) {
    return section.replace("channels.", "channel / ");
  }
  return section.replace(/\./g, " / ");
}

function sectionRank(section: string): number {
  if (section === "general") return 0;
  if (section === "gateway") return 10;
  if (section === "providers") return 20;
  if (section.startsWith("providers.models.")) return 21;
  if (section === "channels") return 30;
  if (section.startsWith("channels.")) return 31;
  if (section === "agent") return 40;
  if (section.startsWith("agent.")) return 41;
  if (section === "memory") return 50;
  if (section.startsWith("memory.")) return 51;
  if (section === "reliability") return 60;
  if (section === "scheduler") return 70;
  if (section === "heartbeat") return 80;
  if (section === "workspace") return 90;
  if (section === "cost") return 100;
  return 1000 + section.localeCompare("zzzz");
}

const EMPTY_KEY_SET = new Set<string>();

function keySet(keys: string[]): Set<string> {
  return new Set(keys);
}

const COMMON_SECTION_KEYS: Record<string, Set<string>> = {
  agent: keySet([
    "compact_context",
    "context_aware_tools",
    "keep_tool_context_turns",
    "max_context_tokens",
    "max_history_messages",
    "max_system_prompt_chars",
    "max_tool_iterations",
    "max_tool_result_chars",
    "parallel_tools",
    "tool_dispatcher",
  ]),
  "agent.context_compression": keySet([
    "enabled",
    "identifier_policy",
    "max_passes",
    "protect_first_n",
    "protect_last_n",
    "summary_max_chars",
    "threshold_ratio",
    "timeout_secs",
    "tool_result_retrim_chars",
  ]),
  "agent.history_pruning": keySet([
    "collapse_tool_results",
    "enabled",
    "keep_recent",
    "max_tokens",
  ]),
  "agent.thinking": keySet(["default_level"]),
  channels: keySet([
    "ack_reactions",
    "cli",
    "debounce_ms",
    "message_timeout_secs",
    "session_backend",
    "session_persistence",
    "session_ttl_hours",
    "show_tool_calls",
  ]),
  cost: keySet([
    "allow_override",
    "daily_limit_usd",
    "enabled",
    "monthly_limit_usd",
    "warn_at_percent",
  ]),
  gateway: keySet([
    "allow_public_bind",
    "host",
    "idempotency_ttl_secs",
    "pair_rate_limit_per_minute",
    "port",
    "rate_limit_max_keys",
    "require_pairing",
    "session_persistence",
    "session_ttl_hours",
    "trust_forwarded_headers",
    "webhook_rate_limit_per_minute",
  ]),
  heartbeat: keySet([
    "adaptive",
    "deadman_timeout_minutes",
    "enabled",
    "interval_minutes",
    "max_interval_minutes",
    "max_run_history",
    "min_interval_minutes",
    "task_timeout_secs",
    "two_phase",
  ]),
  memory: keySet([
    "archive_after_days",
    "auto_hydrate",
    "auto_save",
    "backend",
    "chunk_max_tokens",
    "conversation_retention_days",
    "default_namespace",
    "embedding_model",
    "embedding_provider",
    "hygiene_enabled",
    "keyword_weight",
    "min_relevance_score",
    "purge_after_days",
    "response_cache_enabled",
    "response_cache_ttl_minutes",
    "search_mode",
    "snapshot_enabled",
    "vector_weight",
  ]),
  providers: keySet(["fallback"]),
  reliability: keySet([
    "channel_initial_backoff_secs",
    "channel_max_backoff_secs",
    "provider_backoff_ms",
    "provider_retries",
    "scheduler_poll_secs",
    "scheduler_retries",
  ]),
  scheduler: keySet(["enabled", "max_concurrent", "max_tasks"]),
  workspace: keySet([
    "cross_workspace_search",
    "enabled",
    "isolate_audit",
    "isolate_memory",
    "isolate_secrets",
    "workspaces_dir",
  ]),
};
