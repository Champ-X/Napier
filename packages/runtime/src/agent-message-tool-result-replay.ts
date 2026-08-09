import type {
  AgentTool,
  AgentToolResult,
  AfterToolCallResult,
} from "@earendil-works/pi-agent-core";
import type {
  AgentMessageExperimentToolResultReuse,
  RunEvent,
  ToolInvocationCapsuleReceipt,
  ToolInvocationResultCapsuleReceipt,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { AgentMessageExperimentExecution } from "./agent-message-experiment-execution.js";
import {
  replayableToolResult,
  type ToolInvocationResultCapsule,
  validateToolInvocationResultCapsuleReceipt,
} from "./tool-invocation-result-capsule.js";
import type { ToolInvocationResultCapsuleStore } from "./tool-invocation-result-capsule-store.js";
import {
  toolDefinitionSha256,
  toolInvocationArgumentsSha256,
  validateToolInvocationCapsuleReceipt,
} from "./tool-invocation-capsule.js";
import {
  isSkillCatalogBinding,
  isSkillLoadReceipt,
  type SkillCatalogBinding,
} from "./skill-load-contracts.js";
import {
  validateSkillLoadFrozenReplay,
  validateSkillSnapshotForContinuation,
} from "./skill-load-replay.js";
import type { SkillSnapshot } from "./standard-skill-snapshot.js";

export const AGENT_MESSAGE_TOOL_RESULT_REPLAY: unique symbol = Symbol(
  "napier.agent-message-tool-result-replay",
);

export interface FrozenToolResultEntry {
  sourceCallId: string;
  toolName: string;
  toolDefinitionSha256: string;
  argumentsSha256: string;
  invocationCapsuleSha256: string;
  resultCapsuleSha256: string;
  resultSha256: string;
  outputTextSha256: string;
  outputTextBytes: number;
  isError: boolean;
  capsule: ToolInvocationResultCapsule;
}

export interface FrozenToolResultPlan {
  entries: FrozenToolResultEntry[];
  sourceResultSetSha256: string;
  unavailableCount: number;
  sourceSkillBinding?: SkillCatalogBinding;
}

export function validateAgentMessageToolResultReplay(
  experiment: AgentMessageExperimentExecution | undefined,
  replay: FrozenToolResultReplayController | undefined,
): void {
  if (
    (experiment?.toolResultMode === "reuse_source") !== Boolean(replay) ||
    (replay &&
      (replay.sourceThreadId !== experiment?.sourceThreadId ||
        replay.sourceRunId !== experiment.sourceRunId ||
        replay.plan.entries.length !==
          experiment.sourceReusableToolResultCount ||
        replay.plan.sourceResultSetSha256 !==
          experiment.sourceToolResultSetSha256))
  ) {
    throw new Error("Agent message experiment tool result replay is invalid");
  }
}

type SequencedFrozenToolResultEntry = FrozenToolResultEntry & {
  invocationSeq: number;
};

interface Reservation {
  entry: FrozenToolResultEntry;
  targetCallId: string;
  executed: boolean;
  reused: boolean;
}

export class FrozenToolResultReplayController {
  private nextIndex = 0;
  private divergenceCount = 0;
  private readonly reservations = new Map<string, Reservation>();
  private readonly reused: Reservation[] = [];
  private skillSnapshotValidated = false;

  constructor(
    readonly sourceThreadId: string,
    readonly sourceRunId: string,
    readonly plan: FrozenToolResultPlan,
  ) {
    if (plan.entries.length < 1 || plan.unavailableCount !== 0) {
      throw new Error("Frozen tool result plan is incomplete");
    }
  }

  validateTargetSkillSnapshot(snapshot?: SkillSnapshot): void {
    const skillEntries = this.plan.entries.filter(
      (entry) => entry.toolName === "skill_load",
    );
    if (skillEntries.length === 0) {
      this.skillSnapshotValidated = true;
      return;
    }
    if (!snapshot) {
      throw new Error("Frozen Skill load replay requires a Research snapshot");
    }
    const binding = this.plan.sourceSkillBinding;
    validateSkillSnapshotForContinuation(binding, snapshot);
    for (const entry of skillEntries) {
      validateSkillLoadFrozenReplay(binding, snapshot, entry.capsule);
    }
    this.skillSnapshotValidated = true;
  }

  reserve(
    targetCallId: string,
    tool: AgentTool | undefined,
    toolName: string,
    args: unknown,
  ): { block: boolean; reason?: string } {
    if (toolName === "skill_load" && !this.skillSnapshotValidated) {
      this.divergenceCount += 1;
      return {
        block: true,
        reason: "Frozen Skill load replay snapshot was not validated",
      };
    }
    if (this.divergenceCount > 0) {
      return {
        block: true,
        reason: "Frozen tool result replay already diverged",
      };
    }
    const expected = this.plan.entries[this.nextIndex];
    const definitionSha256 = tool ? toolDefinitionSha256(tool) : "";
    const argumentsSha256 = toolInvocationArgumentsSha256(args);
    if (
      !expected ||
      !tool ||
      tool.name !== toolName ||
      expected.toolName !== toolName ||
      expected.toolDefinitionSha256 !== definitionSha256 ||
      expected.argumentsSha256 !== argumentsSha256 ||
      this.reservations.has(targetCallId)
    ) {
      this.divergenceCount += 1;
      return {
        block: true,
        reason: expected
          ? "Candidate tool call does not match the next frozen source result"
          : "Candidate requested an extra tool call beyond the frozen source results",
      };
    }
    this.reservations.set(targetCallId, {
      entry: expected,
      targetCallId,
      executed: false,
      reused: false,
    });
    this.nextIndex += 1;
    return { block: false };
  }

  resultFor(
    targetCallId: string,
    signal?: AbortSignal,
  ): AgentToolResult<unknown> {
    signal?.throwIfAborted();
    const reservation = this.reservations.get(targetCallId);
    if (!reservation || reservation.executed || reservation.reused) {
      this.divergenceCount += 1;
      throw new Error("Frozen tool result reservation is invalid");
    }
    reservation.executed = true;
    return replayableToolResult(reservation.entry.capsule);
  }

  finalize(targetCallId: string):
    | {
        entry: FrozenToolResultEntry;
        patch: AfterToolCallResult;
      }
    | undefined {
    const reservation = this.reservations.get(targetCallId);
    if (!reservation) return undefined;
    if (!reservation.executed || reservation.reused) {
      this.divergenceCount += 1;
      throw new Error("Frozen tool result finalization is invalid");
    }
    reservation.reused = true;
    this.reused.push(reservation);
    return {
      entry: reservation.entry,
      patch: {
        isError: reservation.entry.isError,
      },
    };
  }

  shouldStopAfterTurn(): boolean {
    return this.divergenceCount > 0;
  }

  wasReused(targetCallId: string): boolean {
    return this.reservations.get(targetCallId)?.reused === true;
  }

  assertComplete(): void {
    if (
      this.divergenceCount > 0 ||
      this.nextIndex !== this.plan.entries.length ||
      this.reused.length !== this.plan.entries.length
    ) {
      throw new Error(
        "Candidate did not consume the complete frozen tool result set",
      );
    }
  }

  summary(): AgentMessageExperimentToolResultReuse {
    const targetReuseSetSha256 = sha256(
      canonicalJson(
        this.reused.map((reservation) => ({
          sourceCallId: reservation.entry.sourceCallId,
          targetCallId: reservation.targetCallId,
          toolName: reservation.entry.toolName,
          resultSha256: reservation.entry.resultSha256,
          resultCapsuleSha256: reservation.entry.resultCapsuleSha256,
        })),
      ),
    );
    return {
      mode: "reuse_source",
      sourceResultCount: this.plan.entries.length,
      reusedResultCount: this.reused.length,
      divergenceCount: this.divergenceCount,
      complete:
        this.divergenceCount === 0 &&
        this.reused.length === this.plan.entries.length,
      sourceResultSetSha256: this.plan.sourceResultSetSha256,
      targetReuseSetSha256,
    };
  }
}

export async function projectFrozenToolResultPlan(
  events: RunEvent[],
  sourceThreadId: string,
  sourceRunId: string,
  capsules: ToolInvocationResultCapsuleStore,
): Promise<FrozenToolResultPlan> {
  const sourceEvents = events.filter((event) => event.runId === sourceRunId);
  const skillBindings: SkillCatalogBinding[] = [];
  for (const event of sourceEvents) {
    if (
      event.type === "context.skills" &&
      isSkillCatalogBinding(event.payload)
    ) {
      skillBindings.push(event.payload);
    }
  }
  const sourceSkillBinding =
    skillBindings.length === 1 ? skillBindings[0] : undefined;
  const invocationEvents = sourceEvents.filter(
    (event) => event.type === "context.tool_invocation",
  );
  const entries: SequencedFrozenToolResultEntry[] = [];
  let unavailableCount = 0;
  for (const invocationEvent of invocationEvents) {
    const entry = await projectFrozenToolResultEntry(
      sourceEvents,
      sourceThreadId,
      sourceRunId,
      capsules,
      invocationEvent,
      sourceSkillBinding,
    );
    if (entry) entries.push(entry);
    else unavailableCount += 1;
  }
  entries.sort((left, right) => left.invocationSeq - right.invocationSeq);
  const projectedEntries = entries.map(
    ({ invocationSeq: _invocationSeq, ...entry }) => entry,
  );
  return {
    entries: projectedEntries,
    sourceResultSetSha256: frozenToolResultSetSha256(projectedEntries),
    unavailableCount,
    ...(sourceSkillBinding ? { sourceSkillBinding } : {}),
  };
}

async function projectFrozenToolResultEntry(
  sourceEvents: RunEvent[],
  sourceThreadId: string,
  sourceRunId: string,
  capsules: ToolInvocationResultCapsuleStore,
  invocationEvent: RunEvent,
  sourceSkillBinding: SkillCatalogBinding | undefined,
): Promise<SequencedFrozenToolResultEntry | undefined> {
  const invocation = validateToolInvocationCapsuleReceipt(
    invocationEvent.payload,
  );
  const resultEvents = sourceEvents.filter(
    (event) =>
      event.type === "context.tool_result" &&
      event.seq > invocationEvent.seq &&
      receiptCallId(event) === invocation.callId,
  );
  if (resultEvents.length !== 1) return undefined;
  const resultEvent = resultEvents[0]!;
  const resultReceipt = validateToolInvocationResultCapsuleReceipt(
    resultEvent.payload,
  );
  const terminalEvents = sourceEvents.filter(
    (event) =>
      event.seq > resultEvent.seq &&
      (event.type === "tool.completed" || event.type === "tool.failed") &&
      toolEventBinding(event, invocation),
  );
  if (
    !resultBindsInvocation(resultReceipt, invocation) ||
    terminalEvents.length !== 1 ||
    !terminalBinding(terminalEvents[0]!, resultReceipt)
  ) {
    return undefined;
  }
  try {
    const capsule = await capsules.read(resultReceipt.capsuleSha256);
    if (
      !capsuleBindsResult(
        capsule,
        resultReceipt,
        sourceThreadId,
        sourceRunId,
      ) ||
      !skillLoadSourceBindingIsValid(capsule, sourceSkillBinding)
    ) {
      return undefined;
    }
    return {
      sourceCallId: invocation.callId,
      toolName: invocation.toolName,
      toolDefinitionSha256: invocation.toolDefinitionSha256,
      argumentsSha256: invocation.argumentsSha256,
      invocationCapsuleSha256: invocation.capsuleSha256,
      resultCapsuleSha256: resultReceipt.capsuleSha256,
      resultSha256: resultReceipt.resultSha256,
      outputTextSha256: resultReceipt.outputTextSha256,
      outputTextBytes: resultReceipt.outputTextBytes,
      isError: resultReceipt.isError,
      capsule,
      invocationSeq: invocationEvent.seq,
    };
  } catch {
    return undefined;
  }
}

function resultBindsInvocation(
  result: ToolInvocationResultCapsuleReceipt,
  invocation: ToolInvocationCapsuleReceipt,
): boolean {
  return (
    result.callId === invocation.callId &&
    result.toolName === invocation.toolName &&
    result.invocationCapsuleSha256 === invocation.capsuleSha256 &&
    result.toolDefinitionSha256 === invocation.toolDefinitionSha256 &&
    result.argumentsSha256 === invocation.argumentsSha256
  );
}

function capsuleBindsResult(
  capsule: ToolInvocationResultCapsule,
  result: ToolInvocationResultCapsuleReceipt,
  sourceThreadId: string,
  sourceRunId: string,
): boolean {
  return (
    capsule.sourceThreadId === sourceThreadId &&
    capsule.sourceRunId === sourceRunId &&
    capsule.callId === result.callId &&
    capsule.toolName === result.toolName &&
    capsule.invocationCapsuleSha256 === result.invocationCapsuleSha256 &&
    capsule.toolDefinitionSha256 === result.toolDefinitionSha256 &&
    capsule.argumentsSha256 === result.argumentsSha256 &&
    capsule.isError === result.isError &&
    capsule.resultSha256 === result.resultSha256 &&
    capsule.outputTextSha256 === result.outputTextSha256 &&
    capsule.outputTextBytes === result.outputTextBytes &&
    capsule.contentSha256 === result.capsuleSha256
  );
}

function skillLoadSourceBindingIsValid(
  capsule: ToolInvocationResultCapsule,
  binding: SkillCatalogBinding | undefined,
): boolean {
  if (capsule.toolName !== "skill_load") return true;
  if (!binding) return false;
  // Source receipts must at least bind to the source Run catalog here. Full
  // target-entry equality is checked against the freshly acquired snapshot.
  const details = capsule.result.details;
  return (
    isSkillLoadReceipt(details) &&
    details.schemaVersion === binding.schemaVersion &&
    details.catalogSha256 === binding.catalogSha256 &&
    details.snapshotManifestSha256 === binding.snapshotManifestSha256
  );
}

export function frozenToolResultSetSha256(
  entries: readonly FrozenToolResultEntry[],
): string {
  return sha256(
    canonicalJson(
      entries.map((entry) => ({
        sourceCallId: entry.sourceCallId,
        toolName: entry.toolName,
        toolDefinitionSha256: entry.toolDefinitionSha256,
        argumentsSha256: entry.argumentsSha256,
        invocationCapsuleSha256: entry.invocationCapsuleSha256,
        resultCapsuleSha256: entry.resultCapsuleSha256,
        resultSha256: entry.resultSha256,
        outputTextSha256: entry.outputTextSha256,
        outputTextBytes: entry.outputTextBytes,
        isError: entry.isError,
      })),
    ),
  );
}

export function liveToolResultReuseSummary(
  plan: FrozenToolResultPlan,
): AgentMessageExperimentToolResultReuse {
  return {
    mode: "live",
    sourceResultCount: plan.entries.length,
    reusedResultCount: 0,
    divergenceCount: 0,
    complete: true,
    sourceResultSetSha256: plan.sourceResultSetSha256,
    targetReuseSetSha256: sha256(canonicalJson([])),
  };
}

function receiptCallId(event: RunEvent): string | undefined {
  try {
    return validateToolInvocationResultCapsuleReceipt(event.payload).callId;
  } catch {
    return undefined;
  }
}

function toolEventBinding(
  event: RunEvent,
  invocation: ToolInvocationCapsuleReceipt,
): boolean {
  const payload = record(event.payload);
  return (
    payload?.["callId"] === invocation.callId &&
    payload["toolName"] === invocation.toolName
  );
}

function terminalBinding(
  event: RunEvent,
  result: ToolInvocationResultCapsuleReceipt,
): boolean {
  const payload = record(event.payload);
  return (
    event.type === (result.isError ? "tool.failed" : "tool.completed") &&
    payload?.["status"] === (result.isError ? "failed" : "completed") &&
    payload["outputTextSha256"] === result.outputTextSha256 &&
    payload["outputTextBytes"] === result.outputTextBytes
  );
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
