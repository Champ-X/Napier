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
}

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

  constructor(
    readonly sourceThreadId: string,
    readonly sourceRunId: string,
    readonly plan: FrozenToolResultPlan,
  ) {
    if (plan.entries.length < 1 || plan.unavailableCount !== 0) {
      throw new Error("Frozen tool result plan is incomplete");
    }
  }

  reserve(
    targetCallId: string,
    tool: AgentTool | undefined,
    toolName: string,
    args: unknown,
  ): { block: boolean; reason?: string } {
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
  const invocationEvents = sourceEvents.filter(
    (event) => event.type === "context.tool_invocation",
  );
  const entries: Array<FrozenToolResultEntry & { invocationSeq: number }> = [];
  let unavailableCount = 0;
  for (const invocationEvent of invocationEvents) {
    const invocation = validateToolInvocationCapsuleReceipt(
      invocationEvent.payload,
    );
    const resultEvents = sourceEvents.filter(
      (event) =>
        event.type === "context.tool_result" &&
        event.seq > invocationEvent.seq &&
        receiptCallId(event) === invocation.callId,
    );
    if (resultEvents.length !== 1) {
      unavailableCount += 1;
      continue;
    }
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
      resultReceipt.callId !== invocation.callId ||
      resultReceipt.toolName !== invocation.toolName ||
      resultReceipt.invocationCapsuleSha256 !== invocation.capsuleSha256 ||
      resultReceipt.toolDefinitionSha256 !== invocation.toolDefinitionSha256 ||
      resultReceipt.argumentsSha256 !== invocation.argumentsSha256 ||
      terminalEvents.length !== 1 ||
      !terminalBinding(terminalEvents[0]!, resultReceipt)
    ) {
      unavailableCount += 1;
      continue;
    }
    try {
      const capsule = await capsules.read(resultReceipt.capsuleSha256);
      if (
        capsule.sourceThreadId !== sourceThreadId ||
        capsule.sourceRunId !== sourceRunId ||
        capsule.callId !== resultReceipt.callId ||
        capsule.toolName !== resultReceipt.toolName ||
        capsule.invocationCapsuleSha256 !==
          resultReceipt.invocationCapsuleSha256 ||
        capsule.toolDefinitionSha256 !== resultReceipt.toolDefinitionSha256 ||
        capsule.argumentsSha256 !== resultReceipt.argumentsSha256 ||
        capsule.isError !== resultReceipt.isError ||
        capsule.resultSha256 !== resultReceipt.resultSha256 ||
        capsule.outputTextSha256 !== resultReceipt.outputTextSha256 ||
        capsule.outputTextBytes !== resultReceipt.outputTextBytes ||
        capsule.contentSha256 !== resultReceipt.capsuleSha256
      ) {
        unavailableCount += 1;
        continue;
      }
      entries.push({
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
      });
    } catch {
      unavailableCount += 1;
    }
  }
  entries.sort((left, right) => left.invocationSeq - right.invocationSeq);
  const projectedEntries = entries.map(
    ({ invocationSeq: _invocationSeq, ...entry }) => entry,
  );
  return {
    entries: projectedEntries,
    sourceResultSetSha256: frozenToolResultSetSha256(projectedEntries),
    unavailableCount,
  };
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
