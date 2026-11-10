import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type {
  JsonValue,
  RunEvent,
  RunRecord,
  ToolInvocationResultCapsuleReceipt,
} from "@napier/contracts";
import type { ToolFailureReceiptV1 } from "@napier/contracts/tool-protocol";

import { replayedToolFailureReceipt } from "./agent-tool-failure-replay.js";
import { toolInvocationArgumentsSha256 } from "./tool-invocation-capsule.js";
import {
  replayableToolResult,
  type ToolInvocationResultCapsule,
  validateToolInvocationResultCapsuleReceipt,
} from "./tool-invocation-result-capsule.js";
import type { ToolInvocationResultCapsuleStore } from "./tool-invocation-result-capsule-store.js";
import type { OwnedToolRecordV2 } from "./owned-tool-protocol.js";

export type ExactToolResultReplay = {
  result: AgentToolResult<unknown>;
  isError: boolean;
  resultEvidenceSha256: string;
  failure?: ToolFailureReceiptV1;
};

export async function resolveExactToolResultReplay(input: {
  runEvents: readonly RunEvent[];
  toolCallId: string;
  toolName: string;
  args: unknown;
  protocol: OwnedToolRecordV2;
  resultCapsules: ToolInvocationResultCapsuleStore;
  run: RunRecord;
}): Promise<ExactToolResultReplay | undefined> {
  const candidates = input.runEvents.filter((event) => {
    const payload = jsonRecord(event.payload);
    return (
      event.type === "context.tool_result" &&
      payload?.["callId"] === input.toolCallId
    );
  });
  if (candidates.length === 0) return undefined;
  try {
    const receipts = candidates.map((event) =>
      validateToolInvocationResultCapsuleReceipt(event.payload),
    );
    const receipt = receipts[0]!;
    // Accept duplicate historical receipts only when content-identical.
    if (
      receipts.some(
        (candidate) => candidate.contentSha256 !== receipt.contentSha256,
      )
    ) {
      return undefined;
    }
    if (
      !receiptMatchesInvocation(receipt, input.toolName, input.protocol, input.args)
    ) {
      return undefined;
    }
    const capsule = await input.resultCapsules.read(receipt.capsuleSha256);
    if (!capsuleMatchesReceipt(capsule, receipt, input)) {
      return undefined;
    }
    const failure = replayedToolFailureReceipt(
      input.runEvents,
      input.toolCallId,
    );
    return {
      result: replayableToolResult(capsule),
      isError: capsule.isError,
      resultEvidenceSha256: receipt.contentSha256,
      ...(capsule.isError && failure ? { failure } : {}),
    };
  } catch {
    return undefined;
  }
}

function receiptMatchesInvocation(
  receipt: ToolInvocationResultCapsuleReceipt,
  toolName: string,
  protocol: OwnedToolRecordV2,
  args: unknown,
): boolean {
  return (
    receipt.toolName === toolName &&
    protocol.matchesReplayIdentitySha256(receipt.toolDefinitionSha256) &&
    receipt.argumentsSha256 === toolInvocationArgumentsSha256(args)
  );
}

function capsuleMatchesReceipt(
  capsule: ToolInvocationResultCapsule,
  receipt: ToolInvocationResultCapsuleReceipt,
  input: {
    toolCallId: string;
    toolName: string;
    run: RunRecord;
  },
): boolean {
  return (
    capsule.sourceThreadId === input.run.threadId &&
    capsule.sourceRunId === input.run.id &&
    capsule.callId === input.toolCallId &&
    capsule.toolName === input.toolName &&
    capsule.contentSha256 === receipt.capsuleSha256 &&
    capsule.invocationCapsuleSha256 === receipt.invocationCapsuleSha256 &&
    capsule.toolDefinitionSha256 === receipt.toolDefinitionSha256 &&
    capsule.argumentsSha256 === receipt.argumentsSha256 &&
    capsule.resultSha256 === receipt.resultSha256 &&
    capsule.outputTextSha256 === receipt.outputTextSha256 &&
    capsule.outputTextBytes === receipt.outputTextBytes &&
    capsule.isError === receipt.isError
  );
}

function jsonRecord(
  value: JsonValue | undefined,
): Record<string, JsonValue> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : undefined;
}
