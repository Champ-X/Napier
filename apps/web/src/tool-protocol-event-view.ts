import type {
  ToolConcurrency,
  ToolSideEffect,
} from "@napier/contracts/tool-protocol";

export interface ToolProtocolEventEvidence {
  toolProtocolVersion?: string;
  toolDefinitionSha256?: string;
  toolImplementationSha256?: string;
  toolSideEffect?: ToolSideEffect;
  toolConcurrency?: ToolConcurrency;
  toolCompatibilityMode?: "native" | "compatibility";
}

export interface ToolProtocolEventBase extends ToolProtocolEventEvidence {
  toolName: string;
  status: string;
  effect?: "read" | "write";
}

const SHA256 = /^[a-f0-9]{64}$/u;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const SIDE_EFFECTS = new Set<ToolSideEffect>([
  "none",
  "reversible",
  "irreversible",
  "unknown",
]);
const CONCURRENCY = new Set<ToolConcurrency>([
  "safe",
  "serialized",
  "exclusive",
]);

export function toolProtocolEventEvidence(
  payload: Record<string, unknown>,
  toolName: string,
  status: string,
): ToolProtocolEventEvidence {
  const value = record(payload["toolProtocol"]);
  if (
    value?.["kind"] !== "napier.tool-ui-projection" ||
    value["schemaVersion"] !== 2 ||
    value["toolId"] !== toolName ||
    value["status"] !== status ||
    typeof value["semanticVersion"] !== "string" ||
    !VERSION.test(value["semanticVersion"]) ||
    typeof value["definitionSha256"] !== "string" ||
    !SHA256.test(value["definitionSha256"]) ||
    typeof value["implementationSha256"] !== "string" ||
    !SHA256.test(value["implementationSha256"]) ||
    !SIDE_EFFECTS.has(value["sideEffect"] as ToolSideEffect) ||
    !CONCURRENCY.has(value["concurrency"] as ToolConcurrency) ||
    (value["compatibilityMode"] !== "native" &&
      value["compatibilityMode"] !== "compatibility")
  ) {
    return {};
  }
  return {
    toolProtocolVersion: value["semanticVersion"],
    toolDefinitionSha256: value["definitionSha256"],
    toolImplementationSha256: value["implementationSha256"],
    toolSideEffect: value["sideEffect"] as ToolSideEffect,
    toolConcurrency: value["concurrency"] as ToolConcurrency,
    toolCompatibilityMode: value["compatibilityMode"],
  };
}

export function legacyToolEffect(
  evidence: ToolProtocolEventEvidence,
): "read" | "write" | undefined {
  if (evidence.toolSideEffect === "none") return "read";
  if (
    evidence.toolSideEffect === "reversible" ||
    evidence.toolSideEffect === "irreversible"
  ) {
    return "write";
  }
  return undefined;
}

export function toolProtocolEventBase(
  payload: Record<string, unknown>,
  fallbackStatus?: string,
): ToolProtocolEventBase | undefined {
  const toolName =
    safeText(payload["toolName"]) ?? safeText(payload["sourceToolName"]);
  const status = safeText(payload["status"]) ?? fallbackStatus;
  if (!toolName || !status) return undefined;
  const evidence = toolProtocolEventEvidence(payload, toolName, status);
  const effect = legacyToolEffect(evidence) ?? legacyEffect(payload["effect"]);
  return { toolName, status, ...(effect ? { effect } : {}), ...evidence };
}

export function toolProtocolSummaryParts(
  evidence: ToolProtocolEventEvidence,
): string[] {
  if (!evidence.toolProtocolVersion) return [];
  return [
    `protocol v${evidence.toolProtocolVersion}`,
    `side-effect ${evidence.toolSideEffect}`,
    `concurrency ${evidence.toolConcurrency}`,
    `definition ${evidence.toolDefinitionSha256!.slice(0, 12)}`,
    evidence.toolCompatibilityMode === "compatibility"
      ? "compatibility pi-v1"
      : "native protocol",
  ];
}

function safeText(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,160}$/u.test(value)
    ? value
    : undefined;
}

function legacyEffect(value: unknown): "read" | "write" | undefined {
  return value === "read" || value === "write" ? value : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
