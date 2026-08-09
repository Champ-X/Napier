import { createHash } from "node:crypto";

import type {
  AgentProfile,
  SubagentRole,
  ToolPolicyMode,
  UpdateAgentProfileRequest,
} from "@napier/contracts";
import { AGENT_TOOL_NAMES } from "@napier/contracts";
import type {
  CapabilityDiffOperation,
  CapabilityManagedField,
  CapabilityRestorePreviewV1,
} from "@napier/contracts/agent-capability-contract";

export const DEFAULT_AGENT_CAPABILITY_CONTRACT_ID =
  "napier.default-agent.capabilities" as const;
export const DEFAULT_AGENT_CAPABILITY_CONTRACT_VERSION = 3 as const;

export const DEFAULT_AGENT_CAPABILITY_TOOLS = [
  "list_files",
  "read_file",
  "search_files",
  "list_symbols",
  "inspect_data",
  "data_frame",
  "sqlite_query",
  "inspect_code",
  "read_symbol",
  "web_search",
  "web_fetch",
  "browser",
  "research_source",
  "git_inspect",
  "git_stage_preview",
  "git_stage_apply",
  "git_commit_preview",
  "git_commit_apply",
  "git_branch_create_preview",
  "git_branch_create_apply",
  "git_branch_switch_preview",
  "git_branch_switch_apply",
  "git_review_preview",
  "git_review_apply",
  "apply_patch",
  "verify_workspace",
] as const;

export const DEFAULT_AGENT_CAPABILITY_SKILLS_V1 = [
  "data-analysis",
  "research-brief",
  "software-delivery",
  "artifact-studio",
] as const;

export const DEFAULT_AGENT_CAPABILITY_SKILLS = [
  ...DEFAULT_AGENT_CAPABILITY_SKILLS_V1,
  "browser-automation",
] as const;

export const DEFAULT_AGENT_CAPABILITY_SUBAGENTS = [
  "researcher",
  "reviewer",
  "general",
] as const satisfies readonly SubagentRole[];

export interface ManagedCapabilityPayload {
  readonly toolPolicy: ToolPolicyMode;
  readonly enabledTools: readonly string[];
  readonly enabledSkills: readonly string[];
  readonly enabledSubagents: readonly SubagentRole[];
}

type ManagedCapabilitySource = Readonly<
  Pick<
    ManagedCapabilityPayload,
    "toolPolicy" | "enabledTools" | "enabledSkills"
  > & {
    enabledSubagents?: readonly SubagentRole[];
  }
>;

export interface AgentCapabilityContractRecommendation {
  readonly contractId: typeof DEFAULT_AGENT_CAPABILITY_CONTRACT_ID;
  readonly contractVersion: number;
  readonly recommendationSha256: string;
  readonly recommendation: ManagedCapabilityPayload;
}

export const DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V1: ManagedCapabilityPayload =
  deepFreeze({
    toolPolicy: "observe" as const,
    enabledTools: sortedUnique(DEFAULT_AGENT_CAPABILITY_TOOLS),
    enabledSkills: sortedUnique(DEFAULT_AGENT_CAPABILITY_SKILLS_V1),
    enabledSubagents: sortedUnique(DEFAULT_AGENT_CAPABILITY_SUBAGENTS),
  });

export const DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V1_SHA256 = sha256(
  canonicalJson({
    schemaVersion: 1,
    contractId: DEFAULT_AGENT_CAPABILITY_CONTRACT_ID,
    contractVersion: 1,
    ...DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V1,
  }),
);

export const DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V2: ManagedCapabilityPayload =
  deepFreeze({
    ...DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V1,
    enabledSkills: sortedUnique(DEFAULT_AGENT_CAPABILITY_SKILLS),
  });

export const DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V2_SHA256 = sha256(
  canonicalJson({
    schemaVersion: 1,
    contractId: DEFAULT_AGENT_CAPABILITY_CONTRACT_ID,
    contractVersion: 2,
    ...DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V2,
  }),
);

export const DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V3: ManagedCapabilityPayload =
  deepFreeze({
    ...DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V2,
    enabledTools: sortedUnique([
      ...DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V2.enabledTools,
      "skill_load",
    ]),
  });

export const DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V3_SHA256 = sha256(
  canonicalJson({
    schemaVersion: 1,
    contractId: DEFAULT_AGENT_CAPABILITY_CONTRACT_ID,
    contractVersion: 3,
    ...DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V3,
  }),
);

export const DEFAULT_AGENT_CAPABILITY_RECOMMENDATION =
  DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V3;
export const DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_SHA256 =
  DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V3_SHA256;

export const DEFAULT_AGENT_CAPABILITY_CONTRACT_HISTORY: readonly AgentCapabilityContractRecommendation[] =
  deepFreeze([
    {
      contractId: DEFAULT_AGENT_CAPABILITY_CONTRACT_ID,
      contractVersion: 1,
      recommendationSha256: DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V1_SHA256,
      recommendation: managedCapabilityPayload(
        DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V1,
      ),
    },
    {
      contractId: DEFAULT_AGENT_CAPABILITY_CONTRACT_ID,
      contractVersion: 2,
      recommendationSha256: DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V2_SHA256,
      recommendation: managedCapabilityPayload(
        DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V2,
      ),
    },
    {
      contractId: DEFAULT_AGENT_CAPABILITY_CONTRACT_ID,
      contractVersion: 3,
      recommendationSha256: DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V3_SHA256,
      recommendation: managedCapabilityPayload(
        DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V3,
      ),
    },
  ]);

export const HISTORICAL_DEFAULT_CAPABILITY_SIGNATURES = Object.freeze({
  "37a048ba2fe081ead4665dea0bce95a6b30c56e2":
    "ac15ac4783ddfc45df07e112d5b50db5278d41cabd5eac17a55a1e38e171da70",
  "0da2f2d4c24519cc83f1d7a2bbe18ed86db6c05d":
    "2995f55cd7ea5ded57f11febe0342e3086cd48fe7913eb0c9832c603f7b4d265",
});

const KNOWN_TOOL_NAMES = new Set<string>(AGENT_TOOL_NAMES);
const WRITE_TOOLS = new Set([
  "apply_patch",
  "web_fetch_save",
  "lsp_rename_apply",
  "lsp_code_action_apply",
  "workspace_file_apply",
  "git_stage_apply",
  "git_commit_apply",
  "git_branch_create_apply",
  "git_branch_switch_apply",
  "git_review_apply",
]);
const PROCESS_TOOLS = new Set([
  "run_command",
  "javascript_kernel",
  "python_kernel",
  "node_debugger",
  "workspace_process",
]);

export function managedCapabilityPayload(
  profile: ManagedCapabilitySource,
): ManagedCapabilityPayload {
  return {
    toolPolicy: profile.toolPolicy,
    enabledTools: sortedUnique(profile.enabledTools),
    enabledSkills: sortedUnique(profile.enabledSkills),
    enabledSubagents: sortedUnique(profile.enabledSubagents ?? []),
  };
}

export function managedCapabilitySha256(
  profile: ManagedCapabilitySource,
): string {
  return sha256(canonicalJson(managedCapabilityPayload(profile)));
}

export function historicalDefaultCapabilitySignature(
  profile: ManagedCapabilitySource,
): string | undefined {
  if (profile.toolPolicy !== "observe") return undefined;
  const signature = managedCapabilitySha256(profile);
  return Object.values(HISTORICAL_DEFAULT_CAPABILITY_SIGNATURES).some(
    (candidate: string) => candidate === signature,
  )
    ? signature
    : undefined;
}

export function recommendedCapabilityUpdate(): Pick<
  AgentProfile,
  "toolPolicy" | "enabledTools" | "enabledSkills" | "enabledSubagents"
> &
  UpdateAgentProfileRequest {
  return {
    toolPolicy: DEFAULT_AGENT_CAPABILITY_RECOMMENDATION.toolPolicy,
    enabledTools: [...DEFAULT_AGENT_CAPABILITY_RECOMMENDATION.enabledTools],
    enabledSkills: [...DEFAULT_AGENT_CAPABILITY_RECOMMENDATION.enabledSkills],
    enabledSubagents: [
      ...DEFAULT_AGENT_CAPABILITY_RECOMMENDATION.enabledSubagents,
    ],
  };
}

export function createCapabilityRestorePreview(
  profile: Pick<
    AgentProfile,
    | "id"
    | "revision"
    | "toolPolicy"
    | "enabledTools"
    | "enabledSkills"
    | "enabledSubagents"
  >,
): CapabilityRestorePreviewV1 {
  const current = managedCapabilityPayload(profile);
  const target = DEFAULT_AGENT_CAPABILITY_RECOMMENDATION;
  const operations = capabilityDiffOperations(current, target);
  const content = {
    schemaVersion: 1 as const,
    contractId: DEFAULT_AGENT_CAPABILITY_CONTRACT_ID,
    contractVersion: DEFAULT_AGENT_CAPABILITY_CONTRACT_VERSION,
    recommendationSha256: DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_SHA256,
    agentId: profile.id,
    agentRevision: profile.revision,
    currentManagedStateSha256: sha256(canonicalJson(current)),
    targetManagedStateSha256: sha256(canonicalJson(target)),
    operations,
  };
  return {
    ...content,
    diffSha256: sha256(canonicalJson(content)),
  };
}

export function capabilityEffect(
  field: CapabilityManagedField,
  value: string,
): Pick<CapabilityDiffOperation, "effect" | "risk"> {
  if (field === "toolPolicy") {
    return {
      effect: "policy",
      risk:
        value === "observe" ? "low" : value === "workspace" ? "medium" : "high",
    };
  }
  if (field === "enabledSkills") {
    return { effect: "skill_catalog", risk: "low" };
  }
  if (field === "enabledSubagents") {
    return { effect: "delegation", risk: "medium" };
  }
  if (!KNOWN_TOOL_NAMES.has(value)) {
    return { effect: "unknown", risk: "unknown" };
  }
  if (PROCESS_TOOLS.has(value)) return { effect: "process", risk: "high" };
  if (WRITE_TOOLS.has(value) || value.endsWith("_apply")) {
    return { effect: "workspace_write", risk: "high" };
  }
  if (value === "browser") {
    return { effect: "browser_observe", risk: "medium" };
  }
  if (
    value === "web_search" ||
    value === "web_fetch" ||
    value === "research_source"
  ) {
    return { effect: "network_read", risk: "low" };
  }
  return { effect: "read", risk: "low" };
}

export function canonicalCapabilityJson(value: unknown): string {
  return canonicalJson(value);
}

export function capabilitySha256(value: unknown): string {
  return sha256(canonicalJson(value));
}

export function createAgentCapabilityContractRecommendation(
  contractVersion: number,
  recommendation: ManagedCapabilityPayload,
): AgentCapabilityContractRecommendation {
  if (!Number.isInteger(contractVersion) || contractVersion < 1) {
    throw new Error("Capability contract version must be a positive integer");
  }
  const normalized = managedCapabilityPayload(recommendation);
  return deepFreeze({
    contractId: DEFAULT_AGENT_CAPABILITY_CONTRACT_ID,
    contractVersion,
    recommendationSha256: sha256(
      canonicalJson({
        schemaVersion: 1,
        contractId: DEFAULT_AGENT_CAPABILITY_CONTRACT_ID,
        contractVersion,
        ...normalized,
      }),
    ),
    recommendation: normalized,
  });
}

export function compareCanonicalText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function capabilityDiffOperations(
  current: ManagedCapabilityPayload,
  target: ManagedCapabilityPayload,
): CapabilityDiffOperation[] {
  const operations: CapabilityDiffOperation[] = [];
  if (current.toolPolicy !== target.toolPolicy) {
    operations.push({
      field: "toolPolicy",
      operation: "replace",
      value: target.toolPolicy,
      ...capabilityEffect("toolPolicy", target.toolPolicy),
    });
  }
  appendSetDiff(
    operations,
    "enabledTools",
    current.enabledTools,
    target.enabledTools,
  );
  appendSetDiff(
    operations,
    "enabledSkills",
    current.enabledSkills,
    target.enabledSkills,
  );
  appendSetDiff(
    operations,
    "enabledSubagents",
    current.enabledSubagents,
    target.enabledSubagents,
  );
  return operations.sort((left, right) =>
    compareCanonicalText(
      `${left.field}:${left.operation}:${left.value}`,
      `${right.field}:${right.operation}:${right.value}`,
    ),
  );
}

function appendSetDiff(
  operations: CapabilityDiffOperation[],
  field: Exclude<CapabilityManagedField, "toolPolicy">,
  current: readonly string[],
  target: readonly string[],
): void {
  const currentSet = new Set(current);
  const targetSet = new Set(target);
  for (const value of target) {
    if (currentSet.has(value)) continue;
    operations.push({
      field,
      operation: "add",
      value,
      ...capabilityEffect(field, value),
    });
  }
  for (const value of current) {
    if (targetSet.has(value)) continue;
    operations.push({
      field,
      operation: "remove",
      value,
      ...capabilityEffect(field, value),
    });
  }
}

function sortedUnique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort(compareCanonicalText);
}

function deepFreeze<Value>(value: Value): Value {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort(compareCanonicalText)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}
