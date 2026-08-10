import type { AgentProfile } from "@napier/contracts";
import {
  agentCapabilityStatus,
  type AgentCapabilityPresetId,
} from "@napier/contracts/agent-capabilities";
import type {
  CapabilityReadinessRecord,
  EffectiveAgentCapabilityProjectionV1,
} from "@napier/contracts/agent-capability-contract";
import {
  initialComposerRunReadiness,
  type ComposerReadinessItem,
  type ComposerRunReadiness,
} from "./composer-readiness-types";

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
  | "custom";

const NETWORK_MODES = new Set<ModeId>([
  "research",
  "browser",
  "safe_automation",
]);
const SANDBOX_MODES = new Set<ModeId>(["coding", "safe_automation"]);
const BROWSER_MODES = new Set<ModeId>([
  "research",
  "browser",
  "safe_automation",
]);

export function composerRunReadiness(
  profile: AgentProfile | undefined,
  projection: EffectiveAgentCapabilityProjectionV1 | undefined,
  loading: boolean,
  error: string | undefined,
  selectedPreset?: AgentCapabilityPresetId,
): ComposerRunReadiness {
  const modeId =
    selectedPreset ??
    (profile ? agentCapabilityStatus(profile).presetId : "custom");
  if (!projection) {
    if (loading) return initialComposerRunReadiness();
    const initial = initialComposerRunReadiness();
    return {
      ...initial,
      message: `Effective capability readiness is unavailable${error ? "; review the capability contract before sending" : ""}.`,
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
      message:
        "Refreshing effective readiness for the selected task mode before sending.",
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
    level: blocked.length > 0 ? "blocked" : warned.length > 0 ? "warn" : "ready",
    message:
      blocked.length > 0
        ? `Cannot start ${modeLabel(modeId)}: ${blocked.map((item) => `${item.label} ${item.value.toLowerCase()}`).join("; ")}. Review or restore capabilities before sending.`
        : warned.some(
              (item) =>
                item.id === "sandbox" && item.value === "Host direct",
            )
          ? "Host-direct execution is explicitly enabled without OS isolation. Commands run on this machine."
          : "",
    items,
  };
}

function networkReadiness(
  modeId: ModeId,
  projection: EffectiveAgentCapabilityProjectionV1,
): ComposerReadinessItem {
  if (!NETWORK_MODES.has(modeId)) {
    return inactiveItem("network", "Network", "Not needed");
  }
  const records = ["web_search", "web_fetch"].map((tool) =>
    toolReadiness(projection, tool),
  );
  return combinedToolReadiness(
    "network",
    "Network",
    records,
    "Search + Fetch",
    "Search or Fetch is not exposed by the effective Runtime.",
  );
}

function sandboxReadiness(
  modeId: ModeId,
  projection: EffectiveAgentCapabilityProjectionV1,
): ComposerReadinessItem {
  const record = projection.readiness.find((item) =>
    item.id.startsWith("sandbox:"),
  );
  const required = SANDBOX_MODES.has(modeId);
  if (!required) {
    return inactiveItem("sandbox", "Sandbox", "Not needed");
  }
  if (!record || unavailable(record)) {
    return {
      id: "sandbox",
      label: "Sandbox",
      value: "Unavailable",
      state: "blocked",
      detail:
        record?.detail ??
        "No supported Sandbox provider is reported by the Runtime.",
    };
  }
  if (record.id === "sandbox:host-direct") {
    return {
      id: "sandbox",
      label: "Sandbox",
      value: "Host direct",
      state: "warn",
      detail:
        "Explicit host-direct mode is active. It provides no OS isolation.",
    };
  }
  return {
    id: "sandbox",
    label: "Sandbox",
    value:
      record.status === "ready" ? "Ready" : "Available · unverified",
    state: record.status === "ready" ? "ready" : "warn",
    detail: record.detail,
  };
}

function browserReadiness(
  modeId: ModeId,
  projection: EffectiveAgentCapabilityProjectionV1,
): ComposerReadinessItem {
  if (!BROWSER_MODES.has(modeId)) {
    return inactiveItem("browser", "Browser", "Not needed");
  }
  const record = toolReadiness(projection, "browser");
  if (!record || unavailable(record)) {
    const required = modeId === "browser";
    return {
      id: "browser",
      label: "Browser",
      value: required ? "Unavailable" : "Static only",
      state: required ? "blocked" : "warn",
      detail: required
        ? "Browser mode requires the Browser tool to be exposed."
        : "Dynamic-page Browser fallback is unavailable; static Search and Fetch can still run.",
    };
  }
  return {
    id: "browser",
    label: "Browser",
    value:
      record.status === "ready" ? "Ready" : "Available · unverified",
    state: record.status === "ready" ? "ready" : "warn",
    detail: record.detail,
  };
}

function permissionReadiness(
  projection: EffectiveAgentCapabilityProjectionV1,
): ComposerReadinessItem {
  const value =
    projection.toolPolicy === "observe"
      ? "Read only"
      : projection.toolPolicy === "workspace"
        ? "Workspace changes"
        : "External confirm";
  return {
    id: "permission",
    label: "Permission",
    value,
    state: "ready",
    detail:
      projection.toolPolicy === "observe"
        ? "This Run can observe but cannot mutate the workspace or perform external side effects."
        : projection.toolPolicy === "workspace"
          ? "Workspace changes are enabled; high-impact external effects still require confirmation."
          : "External interaction is confirmation-bound.",
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
      value: "Unavailable",
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
    value: unverified ? `${readyValue} · unverified` : readyValue,
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
    detail: `${label} is not required by the active task mode.`,
  };
}

function modeLabel(modeId: ModeId): string {
  return modeId === "safe_automation"
    ? "Safe Automation"
    : modeId === "custom"
      ? "Custom mode"
      : `${modeId.charAt(0).toUpperCase()}${modeId.slice(1)}`;
}
