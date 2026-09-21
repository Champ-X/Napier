import type { ModelContextEnvelopeReceipt, RunRecord } from "@napier/contracts";
import {
  ModelThinkingLoopError,
  parseModelThinkingLoopError,
  type ModelThinkingLoopEvidence,
} from "./model-thinking-loop-policy.js";
import {
  MAX_THINKING_TRACE_BYTES,
  type ModelThinkingTraceSnapshot,
} from "./model-thinking-trace.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import { LocalPrivateCapsuleStore } from "./local-private-capsule-store.js";

interface ThinkingTraceCapsule {
  kind: "napier.model-thinking-trace";
  schemaVersion: 1;
  sourceThreadId: string;
  sourceRunId: string;
  turnIndex: number;
  contextEnvelopeSha256: string;
  evidence: ModelThinkingLoopEvidence;
  trace: ModelThinkingTraceSnapshot;
  contentSha256: string;
}

export class ModelThinkingTraceStore {
  private readonly capsules: LocalPrivateCapsuleStore<ThinkingTraceCapsule>;

  constructor(dataRoot: string) {
    this.capsules = new LocalPrivateCapsuleStore({
      dataRoot,
      directory: "model-thinking-traces",
      label: "Model thinking trace",
      maxObjectBytes: MAX_THINKING_TRACE_BYTES * 6 + 4096,
      maxObjects: 512,
      maxStorageBytes: 64 * 1024 * 1024,
      parse: parseCapsule,
      contentSha256: (value) => value.contentSha256,
    });
  }

  async put(
    input: Omit<
      ThinkingTraceCapsule,
      "kind" | "schemaVersion" | "contentSha256"
    >,
  ) {
    const content = {
      kind: "napier.model-thinking-trace" as const,
      schemaVersion: 1 as const,
      ...input,
    };
    const capsule = {
      ...content,
      contentSha256: sha256(canonicalJson(content)),
    };
    const stored = await this.capsules.put(
      capsule.contentSha256,
      canonicalJson(capsule),
    );
    return {
      status: "stored" as const,
      storage: "local_only" as const,
      capsuleSha256: stored.value.contentSha256,
      capsuleBytes: stored.bytes,
      observedBytes: input.trace.observedBytes,
      capturedBytes: input.trace.capturedBytes,
      truncated: input.trace.truncated,
    };
  }

  read(contentSha256: string) {
    return this.capsules.read(contentSha256);
  }
}

export async function recordModelThinkingTrace(
  dataRoot: string,
  run: Pick<RunRecord, "id" | "threadId">,
  envelope: ModelContextEnvelopeReceipt | undefined,
  evidence: ModelThinkingLoopEvidence,
  trace: ModelThinkingTraceSnapshot,
) {
  if (!envelope)
    return { status: "unavailable", reason: "missing_input_binding" } as const;
  if (!trace.observedChunks)
    return { status: "unavailable", reason: "no_reasoning_deltas" } as const;
  try {
    return await new ModelThinkingTraceStore(dataRoot).put({
      sourceThreadId: run.threadId,
      sourceRunId: run.id,
      turnIndex: envelope.turnIndex,
      contextEnvelopeSha256: envelope.contentSha256,
      evidence,
      trace,
    });
  } catch (error) {
    // Capture failure must not replace the watchdog, budget or caller outcome.
    return {
      status: "unavailable",
      reason: "storage_failed",
      diagnosticSha256: sha256(String(error)),
    } as const;
  }
}

function parseCapsule(serialized: string): ThinkingTraceCapsule {
  const value = JSON.parse(serialized) as ThinkingTraceCapsule;
  const { contentSha256, ...content } = value;
  const parsedEvidence = parseModelThinkingLoopError(
    new ModelThinkingLoopError(value.evidence).message,
  )?.evidence;
  if (
    value.kind !== "napier.model-thinking-trace" ||
    value.schemaVersion !== 1 ||
    !/^thread_[a-z0-9]{8,80}$/u.test(value.sourceThreadId) ||
    !/^run_[a-z0-9_-]{8,80}$/u.test(value.sourceRunId) ||
    !Number.isSafeInteger(value.turnIndex) ||
    value.turnIndex < 0 ||
    !/^[a-f0-9]{64}$/u.test(value.contextEnvelopeSha256) ||
    contentSha256 !== sha256(canonicalJson(content)) ||
    !parsedEvidence ||
    canonicalJson(parsedEvidence) !== canonicalJson(value.evidence) ||
    !validTrace(value.trace)
  )
    throw new Error("Model thinking trace capsule is invalid");
  return value;
}

function validTrace(trace: ModelThinkingTraceSnapshot): boolean {
  return !(
    trace.encoding !== "utf8_deltas" ||
    typeof trace.text !== "string" ||
    !Number.isSafeInteger(trace.observedBytes) ||
    trace.observedBytes < 1 ||
    !Number.isSafeInteger(trace.observedChunks) ||
    trace.observedChunks < 1 ||
    trace.observedChunks > trace.observedBytes ||
    trace.capturedBytes !== Buffer.byteLength(trace.text, "utf8") ||
    trace.capturedBytes > MAX_THINKING_TRACE_BYTES ||
    trace.capturedBytes > trace.observedBytes ||
    trace.capturedSha256 !== sha256(trace.text) ||
    !/^[a-f0-9]{64}$/u.test(trace.observedSha256) ||
    trace.truncated !== trace.capturedBytes < trace.observedBytes ||
    (!trace.truncated && trace.observedSha256 !== trace.capturedSha256)
  );
}
