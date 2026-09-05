import type {
  AgentTool,
  BeforeToolCallResult,
} from "@earendil-works/pi-agent-core";
import type { AgentProfile, RunRecord } from "@napier/contracts";

import { createAgentPromptBuilder } from "./agent-prompt-builder.js";
import {
  preflightAgentToolPolicy,
  recordAgentToolPolicyBlock,
} from "./agent-tool-policy-preflight.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import { validateCompiledPromptArtifact } from "./prompt-compiler.js";
import { createOwnedToolRecordV2 } from "./owned-tool-protocol.js";

export interface AgentTurnPromptAdapter {
  id: string;
  create: typeof createAgentPromptBuilder;
}

export interface AgentTurnToolCandidates {
  immediate: readonly AgentTool[];
  deferred: readonly AgentTool[];
}

export interface AgentTurnToolAdapter {
  id: string;
  select(
    candidates: AgentTurnToolCandidates,
  ): AgentTurnToolCandidates | Promise<AgentTurnToolCandidates>;
}

type BuiltInAgentToolPolicyInput = Parameters<
  typeof preflightAgentToolPolicy
>[0];

export interface AgentTurnPolicyInput {
  run: Readonly<
    Pick<RunRecord, "id" | "threadId"> & { source?: RunRecord["source"] }
  >;
  profile: Readonly<Pick<AgentProfile, "id" | "toolPolicy">>;
  restrictedReadOnlyExecution: boolean;
  toolCall: Readonly<{ id: string; name: string }>;
  args: unknown;
  signal?: AbortSignal;
}

export interface AgentTurnPolicyAdapter {
  id: string;
  preflight(
    input: AgentTurnPolicyInput,
  ):
    | BeforeToolCallResult
    | undefined
    | Promise<BeforeToolCallResult | undefined>;
}

export interface AgentTurnPipelineAdapters {
  prompt: AgentTurnPromptAdapter;
  tool: AgentTurnToolAdapter;
  policy: AgentTurnPolicyAdapter;
}

export interface AgentTurnPipelineInspection {
  promptAdapterId: string;
  toolAdapterId: string;
  policyAdapterId: string;
  contentSha256: string;
}

export interface AgentTurnToolSelectionReceipt {
  candidateToolSetSha256: string;
  activeToolSetSha256: string;
}

export interface AgentTurnToolSelection extends AgentTurnToolCandidates {
  immediate: AgentTool[];
  deferred: AgentTool[];
  receipt: AgentTurnToolSelectionReceipt;
}

const ADAPTER_ID = /^[a-z][a-z0-9_.-]{2,79}$/u;

export const DEFAULT_AGENT_TURN_PROMPT_ADAPTER: AgentTurnPromptAdapter =
  Object.freeze({
    id: "napier.prompt.default",
    create: createAgentPromptBuilder,
  });

export const DEFAULT_AGENT_TURN_TOOL_ADAPTER: AgentTurnToolAdapter =
  Object.freeze({
    id: "napier.tool.default",
    select: (candidates: AgentTurnToolCandidates) => candidates,
  });

export const DEFAULT_AGENT_TURN_POLICY_ADAPTER: AgentTurnPolicyAdapter =
  Object.freeze({
    id: "napier.policy.default",
    preflight: () => undefined,
  });

export function createDefaultAgentTurnPipeline(): AgentTurnPipeline {
  return new AgentTurnPipeline({
    prompt: DEFAULT_AGENT_TURN_PROMPT_ADAPTER,
    tool: DEFAULT_AGENT_TURN_TOOL_ADAPTER,
    policy: DEFAULT_AGENT_TURN_POLICY_ADAPTER,
  });
}

export class AgentTurnPipeline {
  private readonly adapters: AgentTurnPipelineAdapters;
  private readonly inspection: AgentTurnPipelineInspection;

  constructor(adapters: AgentTurnPipelineAdapters) {
    for (const [kind, adapter] of Object.entries(adapters)) {
      if (!ADAPTER_ID.test(adapter.id)) {
        throw new Error(
          `Agent Turn ${kind} adapter ID is invalid: ${adapter.id}`,
        );
      }
    }
    this.adapters = Object.freeze({
      prompt: Object.freeze({ ...adapters.prompt }),
      tool: Object.freeze({ ...adapters.tool }),
      policy: Object.freeze({ ...adapters.policy }),
    });
    const identity = {
      version: "napier.agent-turn-pipeline.v1",
      promptAdapterId: adapters.prompt.id,
      toolAdapterId: adapters.tool.id,
      policyAdapterId: adapters.policy.id,
    };
    this.inspection = Object.freeze({
      promptAdapterId: identity.promptAdapterId,
      toolAdapterId: identity.toolAdapterId,
      policyAdapterId: identity.policyAdapterId,
      contentSha256: sha256(canonicalJson(identity)),
    });
  }

  inspect(): AgentTurnPipelineInspection {
    return this.inspection;
  }

  resolutionEvidence(receipt: AgentTurnToolSelectionReceipt) {
    return {
      turnPipelineSha256: this.inspection.contentSha256,
      candidateToolSetSha256: receipt.candidateToolSetSha256,
      activeToolSetSha256: receipt.activeToolSetSha256,
    };
  }

  async compileTools(
    candidates: AgentTurnToolCandidates,
  ): Promise<AgentTurnToolSelection> {
    assertUniqueToolNames(
      candidates.immediate,
      candidates.deferred,
      "candidate",
    );
    const input = Object.freeze({
      immediate: Object.freeze([...candidates.immediate]),
      deferred: Object.freeze([...candidates.deferred]),
    });
    const candidateDefinitions = new Map(
      [...input.immediate, ...input.deferred].map((tool) => [
        tool,
        agentTurnToolIntegritySha256(tool),
      ]),
    );
    const selected = await this.adapters.tool.select(input);
    if (
      !selected ||
      typeof selected !== "object" ||
      !Array.isArray(selected.immediate) ||
      !Array.isArray(selected.deferred)
    ) {
      throw new Error(
        `Agent Turn tool adapter ${this.adapters.tool.id} returned an invalid selection`,
      );
    }
    assertToolSubset(input.immediate, selected.immediate, "immediate");
    assertToolSubset(input.deferred, selected.deferred, "deferred");
    for (const [tool, definitionSha256] of candidateDefinitions) {
      if (agentTurnToolIntegritySha256(tool) !== definitionSha256) {
        throw new Error(
          `Agent Turn tool adapter ${this.adapters.tool.id} mutated a candidate tool`,
        );
      }
    }
    assertUniqueToolNames(selected.immediate, selected.deferred, "active");
    const immediate = [...selected.immediate];
    const deferred = [...selected.deferred];
    return {
      immediate,
      deferred,
      receipt: Object.freeze({
        candidateToolSetSha256: toolSetSha256(input),
        activeToolSetSha256: toolSetSha256({ immediate, deferred }),
      }),
    };
  }

  createPromptBuilder(
    ...input: Parameters<typeof createAgentPromptBuilder>
  ): ReturnType<typeof createAgentPromptBuilder> {
    const builder = this.adapters.prompt.create(...input);
    if (typeof builder !== "function") {
      throw new Error(
        `Agent Turn prompt adapter ${this.adapters.prompt.id} returned an invalid builder`,
      );
    }
    return (...args) => validateCompiledPromptArtifact(builder(...args));
  }

  async preflightPolicy(
    input: BuiltInAgentToolPolicyInput,
  ): Promise<BeforeToolCallResult | undefined> {
    const builtInBlock = await preflightAgentToolPolicy(input);
    if (builtInBlock) return builtInBlock;
    const additionalBlock = await this.adapters.policy.preflight({
      run: Object.freeze({
        id: input.run.id,
        threadId: input.run.threadId,
        ...(input.run.source ? { source: input.run.source } : {}),
      }),
      profile: Object.freeze({
        id: input.profile.id,
        toolPolicy: input.profile.toolPolicy,
      }),
      restrictedReadOnlyExecution: input.restrictedReadOnlyExecution,
      toolCall: Object.freeze({ ...input.toolCall }),
      args: structuredClone(input.args),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (additionalBlock === undefined) return undefined;
    if (
      additionalBlock.block !== true ||
      typeof additionalBlock.reason !== "string" ||
      !additionalBlock.reason.trim()
    ) {
      throw new Error(
        `Agent Turn policy adapter ${this.adapters.policy.id} may only add an explicit block`,
      );
    }
    return recordAgentToolPolicyBlock(input, additionalBlock.reason);
  }
}

function assertToolSubset(
  candidates: readonly AgentTool[],
  selected: readonly AgentTool[],
  phase: string,
): void {
  const allowed = new Set(candidates);
  for (const tool of selected) {
    if (!allowed.has(tool)) {
      throw new Error(
        `Agent Turn tool adapter returned a non-candidate ${phase} tool`,
      );
    }
  }
}

function assertUniqueToolNames(
  immediate: readonly AgentTool[],
  deferred: readonly AgentTool[],
  kind: string,
): void {
  const names = new Set<string>();
  for (const tool of [...immediate, ...deferred]) {
    if (!tool || typeof tool.name !== "string" || !tool.name) {
      throw new Error(`Agent Turn ${kind} tool definition is invalid`);
    }
    if (names.has(tool.name)) {
      throw new Error(
        `Agent Turn ${kind} tool name is duplicated: ${tool.name}`,
      );
    }
    names.add(tool.name);
  }
}

function toolSetSha256(candidates: AgentTurnToolCandidates): string {
  return sha256(
    canonicalJson({
      immediate: candidates.immediate.map((tool) => ({
        name: tool.name,
        definitionSha256: agentTurnToolIntegritySha256(tool),
      })),
      deferred: candidates.deferred.map((tool) => ({
        name: tool.name,
        definitionSha256: agentTurnToolIntegritySha256(tool),
      })),
    }),
  );
}

function agentTurnToolIntegritySha256(tool: AgentTool): string {
  const protocol = createOwnedToolRecordV2(tool);
  return sha256(
    canonicalJson({
      definitionSha256: protocol.definitionSha256,
      implementationSha256: protocol.implementationSha256,
      label: tool.label,
      executionMode: tool.executionMode ?? "default",
    }),
  );
}
