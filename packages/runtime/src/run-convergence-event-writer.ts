import type { UserMessage } from "@earendil-works/pi-ai";
import type { JsonObject, RunEvent, RunRecord } from "@napier/contracts";

import { sha256 } from "./ed25519.js";
import type { EventSink } from "./event-sink.js";
import type { AppendEventInput } from "./run-event-registry.js";
import { emitRunConvergenceEvent as emit } from "./run-convergence-controller-support.js";

export interface RunConvergenceEventStore {
  appendEventOnceAtRunHead(
    input: AppendEventInput,
    options: {
      namespace: string;
      key: string;
      expectedRunHeadSeq: number;
    },
  ): Promise<{ event: RunEvent; appended: boolean }>;
}

interface RunConvergenceEventWriteContext {
  store: RunConvergenceEventStore;
  run: Pick<RunRecord, "id" | "threadId">;
  onEvent?: EventSink;
  expectedRunHeadSeq: number;
}

export async function appendRunDirectiveDelivery(
  input: RunConvergenceEventWriteContext & {
    directive: {
      id: string;
      kind: "convergence" | "no_progress";
      message: UserMessage;
    };
  },
): Promise<{ event: RunEvent; appended: boolean }> {
  const text = String(input.directive.message.content);
  const receipt = await input.store.appendEventOnceAtRunHead(
    {
      threadId: input.run.threadId,
      runId: input.run.id,
      type: "run.progress.directive.delivered",
      category: "lifecycle",
      visibility: "hidden",
      payload: {
        text,
        runProgressDirectiveId: input.directive.id,
        runProgressDirectiveKind: input.directive.kind,
        textSha256: sha256(text),
      },
    },
    {
      namespace: "run-progress-directive-delivery",
      key: input.directive.id,
      expectedRunHeadSeq: input.expectedRunHeadSeq,
    },
  );
  if (receipt.appended) await emit(input.onEvent, receipt.event);
  return receipt;
}

export async function appendRunOperatorEpoch(
  input: RunConvergenceEventWriteContext & {
    parentControlEpochId: string;
    messages: readonly UserMessage[];
  },
): Promise<{ event: RunEvent; appended: boolean }> {
  const { messageSetSha256, contentSha256 } = runOperatorEpochBinding(
    input.parentControlEpochId,
    input.messages,
  );
  const receipt = await input.store.appendEventOnceAtRunHead(
    {
      threadId: input.run.threadId,
      runId: input.run.id,
      type: "run.progress.operator_epoch",
      category: "lifecycle",
      visibility: "hidden",
      payload: {
        kind: "napier.run-progress-operator-epoch",
        schemaVersion: 1,
        parentControlEpochId: input.parentControlEpochId,
        messageSetSha256,
        contentSha256,
      },
    },
    {
      namespace: "run-progress-operator-epoch",
      key: contentSha256,
      expectedRunHeadSeq: input.expectedRunHeadSeq,
    },
  );
  if (receipt.appended) await emit(input.onEvent, receipt.event);
  return receipt;
}

export function runOperatorEpochBinding(
  parentControlEpochId: string,
  messages: readonly UserMessage[],
): { messageSetSha256: string; contentSha256: string } {
  const messageSetSha256 = sha256(
    messages
      .map(
        (message) => `${String(message.timestamp)}\0${String(message.content)}`,
      )
      .join("\0"),
  );
  return {
    messageSetSha256,
    contentSha256: sha256(`${parentControlEpochId}\0${messageSetSha256}`),
  };
}

export async function appendRunDecisionEvent(
  input: RunConvergenceEventWriteContext & {
    type:
      | "run.progress.convergence_requested"
      | "run.progress.convergence_activated"
      | "run.progress.convergence_reopened"
      | "run.progress.rerouted";
    payload: JsonObject;
  },
): Promise<{ event: RunEvent; appended: boolean }> {
  const decisionId =
    typeof input.payload["decisionId"] === "string"
      ? input.payload["decisionId"]
      : undefined;
  if (!decisionId) {
    throw new Error(
      "Run progress decision requires a deterministic decisionId",
    );
  }
  const receipt = await input.store.appendEventOnceAtRunHead(
    {
      threadId: input.run.threadId,
      runId: input.run.id,
      type: input.type,
      category: "lifecycle",
      visibility: "debug",
      payload: input.payload,
    },
    {
      namespace: "run-progress-decision",
      key: decisionId,
      expectedRunHeadSeq: input.expectedRunHeadSeq,
    },
  );
  if (receipt.appended) await emit(input.onEvent, receipt.event);
  return receipt;
}
