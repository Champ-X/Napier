import { canonicalJson, sha256 } from "./ed25519.js";

export type KernelProfileId = "base" | "web" | "cli";

export interface ResolvedKernelProfile {
  kind: "napier.kernel-profile";
  schemaVersion: 1;
  id: KernelProfileId;
  lineage: KernelProfileId[];
  entryPoints: string[];
  serviceIds: string[];
  hookNames: string[];
  contentSha256: string;
}

const CORE_SERVICE_IDS = [
  "kernel.profile",
  "runtime.agent",
  "runtime.model",
  "runtime.prompt",
  "runtime.tool",
  "runtime.policy",
  "runtime.completion-control",
  "projection.registry",
  "projection.thread-summary",
  "projection.task-narrative",
  "projection.active-plan",
  "projection.conversation-messages",
  "projection.conversation-artifacts",
  "projection.conversation-activity-events",
  "projection.conversation-activity-candidates",
  "projection.conversation-plans",
  "projection.conversation-citations",
  "projection.current-recovery",
  "projection.current-subagents",
  "projection.current-approvals",
] as const;
const CORE_HOOK_NAMES = [
  "turn.start",
  "turn.end",
  "model.request",
  "tool.request",
  "tool.result",
  "completion.control",
] as const;

const PROFILE_ENTRY_POINTS: Record<KernelProfileId, readonly string[]> = {
  base: ["sdk", "embedded"],
  web: ["sdk", "embedded", "http", "sse", "browser-confirmation"],
  cli: ["sdk", "embedded", "terminal", "jsonl", "rpc"],
};

export function resolveKernelProfile(
  id: KernelProfileId,
): ResolvedKernelProfile {
  const core = {
    kind: "napier.kernel-profile" as const,
    schemaVersion: 1 as const,
    id,
    lineage: id === "base" ? ["base" as const] : ["base" as const, id],
    entryPoints: [...PROFILE_ENTRY_POINTS[id]],
    serviceIds: [...CORE_SERVICE_IDS],
    hookNames: [...CORE_HOOK_NAMES],
  };
  return {
    ...core,
    contentSha256: sha256(canonicalJson(core)),
  };
}
