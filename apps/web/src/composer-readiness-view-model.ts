import type { AgentProfile } from "@napier/contracts";
import type { AgentCapabilityPresetId } from "@napier/contracts/agent-capabilities";
import type {
  CapabilityReadinessRecord,
  EffectiveAgentCapabilityProjectionV1,
} from "@napier/contracts/agent-capability-contract";
import {
  initialComposerRunReadiness,
  type ComposerReadinessItem,
  type ComposerRunReadiness,
} from "./composer-readiness-types";
import { composerCopy } from "./composer-copy";
import { copy } from "./copy";

export type {
  ComposerReadinessItem,
  ComposerReadinessState,
  ComposerRunReadiness,
} from "./composer-readiness-types";

type ModeId =
  | "coding"
  | "research"
  | "data"
  | "browser"
  | "safe_automation"
  | "read_only"
  | "full_access"
  | "custom";

const NETWORK_MODES = new Set<ModeId>([
  "research",
  "browser",
  "safe_automation",
  "read_only",
  "full_access",
]);
const SANDBOX_MODES = new Set<ModeId>([
  "coding",
  "safe_automation",
  "full_access",
]);
const BROWSER_MODES = new Set<ModeId>([
  "research",
  "browser",
  "safe_automation",
  "read_only",
  "full_access",
]);
const PROCESS_TOOLS = new Set([
  "run_command",
  "javascript_kernel",
  "python_kernel",
  "node_debugger",
  "workspace_process",
]);

export function composerRunReadiness(
  profile: AgentProfile | undefined,
  projection: EffectiveAgentCapabilityProjectionV1 | undefined,
  loading: boolean,
  error: string | undefined,
  selectedPreset?: AgentCapabilityPresetId,
): ComposerRunReadiness {
  const modeId = selectedPreset ?? "custom";
  if (!projection) {
    if (loading) return initialComposerRunReadiness();
    const initial = initialComposerRunReadiness();
    return {
      ...initial,
      message: error
        ? composerCopy.messages.unavailableWithReview
        : composerCopy.messages.unavailable,
    };
  }
  if (
    profile &&
    (projection.agentId !== profile.id ||
      projection.agentRevision !== profile.revision ||
      projection.capabilityPreset !== selectedPreset)
  ) {
    const initial = initialComposerRunReadiness();
    return {
      ...initial,
      message: composerCopy.messages.refreshing,
    };
  }

  const items = [
    networkReadiness(modeId, projection),
    sandboxReadiness(modeId, projection),
    browserReadiness(modeId, projection),
    permissionReadiness(projection),
  ];
  const blocked = items.filter((item) => item.state === "blocked");
  const warned = items.filter((item) => item.state === "warn");
  return {
    canRun: blocked.length === 0,
    level:
      blocked.length > 0 ? "blocked" : warned.length > 0 ? "warn" : "ready",
    message:
      blocked.length > 0
        ? blockedMessage(modeId, blocked)
        : warned.some(
              (item) =>
                item.id === "sandbox" &&
                item.value === composerCopy.values.readOnlyFallback,
            )
          ? copy.readiness.safeReadsOnly
          : warned.some(
                (item) =>
                  item.id === "sandbox" &&
                  item.value === composerCopy.values.hostDirect,
              )
            ? copy.readiness.hostDirect
            : "",
    items,
  };
}

function blockedMessage(
  modeId: ModeId,
  blocked: ComposerReadinessItem[],
): string {
  const { messages } = composerCopy;
  const reasons = blocked
    .map((item) => `${item.label} ${item.value.toLowerCase()}`)
    .join(messages.blockedItemJoin);
  return `${messages.blockedPrefix}${modeLabel(modeId)}${messages.blockedSeparator}${reasons}${messages.blockedSuffix}`;
}

function networkReadiness(
  modeId: ModeId,
  projection: EffectiveAgentCapabilityProjectionV1,
): ComposerReadinessItem {
  const { labels, values, details } = composerCopy;
  if (!NETWORK_MODES.has(modeId)) {
    return inactiveItem("network", labels.network, values.notNeeded);
  }
  const records = ["web_search", "web_fetch"].map((tool) =>
    toolReadiness(projection, tool),
  );
  return combinedToolReadiness(
    "network",
    labels.network,
    records,
    values.searchFetch,
    details.networkBlocked,
  );
}

function sandboxReadiness(
  modeId: ModeId,
  projection: EffectiveAgentCapabilityProjectionV1,
): ComposerReadinessItem {
  const { labels, values, details } = composerCopy;
  const record = projection.readiness.find((item) =>
    item.id.startsWith("sandbox:"),
  );
  const required =
    SANDBOX_MODES.has(modeId) ||
    (modeId === "custom" &&
      projection.toolPolicy !== "observe" &&
      projection.configuredTools.some((tool) => PROCESS_TOOLS.has(tool)));
  if (!required) {
    return inactiveItem("sandbox", labels.sandbox, values.notNeeded);
  }
  if (!record || unavailable(record)) {
    return {
      id: "sandbox",
      label: labels.sandbox,
      value: values.readOnlyFallback,
      state: "warn",
      detail: record?.detail ?? details.sandboxReadOnlyFallback,
    };
  }
  if (record.id === "sandbox:host-direct") {
    return {
      id: "sandbox",
      label: labels.sandbox,
      value: values.hostDirect,
      state: "warn",
      detail: details.sandboxHostDirect,
    };
  }
  return {
    id: "sandbox",
    label: labels.sandbox,
    value:
      record.status === "ready" ? values.ready : values.availableUnverified,
    state: record.status === "ready" ? "ready" : "warn",
    detail: record.detail,
  };
}

function browserReadiness(
  modeId: ModeId,
  projection: EffectiveAgentCapabilityProjectionV1,
): ComposerReadinessItem {
  const { labels, values, details } = composerCopy;
  if (!BROWSER_MODES.has(modeId)) {
    return inactiveItem("browser", labels.browser, values.notNeeded);
  }
  const record = toolReadiness(projection, "browser");
  if (!record || unavailable(record)) {
    const required = modeId === "browser";
    return {
      id: "browser",
      label: labels.browser,
      value: required ? values.unavailable : values.staticOnly,
      state: required ? "blocked" : "warn",
      detail: required
        ? details.browserRequired
        : details.browserStaticFallback,
    };
  }
  return {
    id: "browser",
    label: labels.browser,
    value:
      record.status === "ready" ? values.ready : values.availableUnverified,
    state: record.status === "ready" ? "ready" : "warn",
    detail: record.detail,
  };
}

function permissionReadiness(
  projection: EffectiveAgentCapabilityProjectionV1,
): ComposerReadinessItem {
  const { labels, values, details } = composerCopy;
  const sandboxUnavailable = projection.readiness.some(
    (record) =>
      record.id.startsWith("sandbox:") && record.status === "unavailable",
  );
  if (sandboxUnavailable && projection.toolPolicy !== "observe") {
    return {
      id: "permission",
      label: labels.permission,
      value: values.readOnlyFallback,
      state: "warn",
      detail: details.permissionReadOnlyFallback,
    };
  }
  const value =
    projection.toolPolicy === "observe"
      ? values.readOnly
      : projection.toolPolicy === "workspace"
        ? values.workspaceChanges
        : values.fullAccess;
  return {
    id: "permission",
    label: labels.permission,
    value,
    state: "ready",
    detail:
      projection.toolPolicy === "observe"
        ? details.permissionObserve
        : projection.toolPolicy === "workspace"
          ? details.permissionWorkspace
          : details.permissionFullAccess,
  };
}

function combinedToolReadiness(
  id: ComposerReadinessItem["id"],
  label: string,
  records: Array<CapabilityReadinessRecord | undefined>,
  readyValue: string,
  blockedDetail: string,
): ComposerReadinessItem {
  if (records.some((record) => !record || unavailable(record))) {
    return {
      id,
      label,
      value: composerCopy.values.unavailable,
      state: "blocked",
      detail: blockedDetail,
    };
  }
  const unverified = records.some(
    (record) => record?.status === "available_unverified",
  );
  return {
    id,
    label,
    value: unverified
      ? `${readyValue}${composerCopy.unverifiedSuffix}`
      : readyValue,
    state: unverified ? "warn" : "ready",
    detail: records.map((record) => record!.detail).join(" "),
  };
}

function toolReadiness(
  projection: EffectiveAgentCapabilityProjectionV1,
  toolName: string,
): CapabilityReadinessRecord | undefined {
  return projection.readiness.find((item) => item.id === `tool:${toolName}`);
}

function unavailable(record: CapabilityReadinessRecord): boolean {
  return [
    "blocked_by_policy",
    "unavailable",
    "missing",
    "unknown_configured",
  ].includes(record.status);
}

function inactiveItem(
  id: ComposerReadinessItem["id"],
  label: string,
  value: string,
): ComposerReadinessItem {
  return {
    id,
    label,
    value,
    state: "inactive",
    detail: composerCopy.details.inactive.replace("{label}", label),
  };
}

function modeLabel(modeId: ModeId): string {
  return composerCopy.modeLabels[modeId];
}
