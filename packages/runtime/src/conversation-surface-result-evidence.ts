import type { RunEvent } from "@napier/contracts";

import type { ConversationSurfaceCapsule } from "./conversation-surface-capsule.js";
import type { ToolInvocationResultCapsuleStore } from "./tool-invocation-result-capsule-store.js";
import { validateToolInvocationCapsuleReceipt } from "./tool-invocation-capsule.js";
import { validateToolInvocationResultCapsuleReceipt } from "./tool-invocation-result-capsule.js";
import { canonicalJson } from "./ed25519.js";

export async function assertConversationSurfaceResultEvidence(input: {
  events: RunEvent[];
  response: RunEvent;
  receiptEvent: RunEvent;
  surface: ConversationSurfaceCapsule;
  resultCapsules: ToolInvocationResultCapsuleStore;
}): Promise<void> {
  for (const result of input.surface.exchange.toolResults) {
    const evidence = evidenceEvents(input, result.toolCallId);
    if (evidence.unavailable.length > 0 || evidence.invocations.length > 1) {
      throw new Error("Conversation Surface result evidence is unavailable");
    }
    if (evidence.invocations.length === 0 && evidence.results.length === 0) {
      continue;
    }
    if (evidence.invocations.length !== 1 || evidence.results.length !== 1) {
      throw new Error("Conversation Surface result receipt binding is invalid");
    }
    const invocation = validateToolInvocationCapsuleReceipt(
      evidence.invocations[0]!.payload,
    );
    const receipt = validateToolInvocationResultCapsuleReceipt(
      evidence.results[0]!.payload,
    );
    const capsule = await input.resultCapsules.read(receipt.capsuleSha256);
    if (
      !receiptsBind(invocation, receipt, result) ||
      !capsuleBinds(capsule, invocation, receipt, result, input.receiptEvent)
    ) {
      throw new Error("Conversation Surface result capsule binding is invalid");
    }
  }
}

function evidenceEvents(
  input: { events: RunEvent[]; response: RunEvent; receiptEvent: RunEvent },
  callId: string,
): { invocations: RunEvent[]; results: RunEvent[]; unavailable: RunEvent[] } {
  const candidates = input.events.filter(
    (event) =>
      event.runId === input.receiptEvent.runId &&
      event.seq > input.response.seq &&
      event.seq < input.receiptEvent.seq &&
      eventCallId(event) === callId,
  );
  return {
    invocations: candidates.filter(
      (event) => event.type === "context.tool_invocation",
    ),
    results: candidates.filter((event) => event.type === "context.tool_result"),
    unavailable: candidates.filter(
      (event) =>
        event.type === "context.tool_invocation_unavailable" ||
        event.type === "context.tool_result_unavailable",
    ),
  };
}

function receiptsBind(
  invocation: ReturnType<typeof validateToolInvocationCapsuleReceipt>,
  receipt: ReturnType<typeof validateToolInvocationResultCapsuleReceipt>,
  result: ConversationSurfaceCapsule["exchange"]["toolResults"][number],
): boolean {
  return (
    invocation.callId === result.toolCallId &&
    invocation.toolName === result.toolName &&
    receipt.callId === invocation.callId &&
    receipt.toolName === invocation.toolName &&
    receipt.invocationCapsuleSha256 === invocation.capsuleSha256 &&
    receipt.toolDefinitionSha256 === invocation.toolDefinitionSha256 &&
    receipt.argumentsSha256 === invocation.argumentsSha256
  );
}

function capsuleBinds(
  capsule: Awaited<ReturnType<ToolInvocationResultCapsuleStore["read"]>>,
  invocation: ReturnType<typeof validateToolInvocationCapsuleReceipt>,
  receipt: ReturnType<typeof validateToolInvocationResultCapsuleReceipt>,
  result: ConversationSurfaceCapsule["exchange"]["toolResults"][number],
  receiptEvent: RunEvent,
): boolean {
  return (
    capsule.sourceThreadId === receiptEvent.threadId &&
    capsule.sourceRunId === receiptEvent.runId &&
    receipt.isError === capsule.isError &&
    receipt.resultSha256 === capsule.resultSha256 &&
    receipt.outputTextSha256 === capsule.outputTextSha256 &&
    receipt.outputTextBytes === capsule.outputTextBytes &&
    capsule.callId === result.toolCallId &&
    capsule.toolName === result.toolName &&
    capsule.invocationCapsuleSha256 === invocation.capsuleSha256 &&
    capsule.toolDefinitionSha256 === invocation.toolDefinitionSha256 &&
    capsule.argumentsSha256 === invocation.argumentsSha256 &&
    capsule.isError === result.isError &&
    capsule.contentSha256 === receipt.capsuleSha256 &&
    sameJson(capsule.result.content, result.content) &&
    sameJson(capsule.result.details, result.details) &&
    sameJson(capsule.result.usage ?? null, result.usage ?? null) &&
    sameJson(capsule.result.addedToolNames ?? [], result.addedToolNames ?? [])
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function eventCallId(event: RunEvent): string | undefined {
  const payload = event.payload;
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? typeof payload["callId"] === "string"
      ? payload["callId"]
      : undefined
    : undefined;
}
