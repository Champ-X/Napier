import type { Api, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import type {
  ModelContextEnvelopeReceipt,
  ModelInvocationCapsuleReceipt,
  ModelInvocationPurpose,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import { PromptCacheProjection } from "./prompt-cache-projection.js";
import { createModelContextEnvelopeReceipt } from "./model-context-envelope.js";
import {
  applyModelAdapterOptions,
  modelAdapterReceipt,
  type ModelAdapterReceiptV2,
} from "./model-adapters.js";
import type { ModelInvocationCapsuleStore } from "./model-invocation-capsule-store.js";
import { snapshotModelInvocation } from "./model-invocation-snapshot.js";
import type { ToolSurfaceRevisionScope } from "./tool-surface-projection.js";

export interface ModelInvocationCaptureUnavailable {
  schemaVersion: 1;
  turnIndex: number;
  purpose: ModelInvocationPurpose;
  model: string;
  contextEnvelopeSha256: string;
  reason: "limit" | "storage" | "invalid";
  diagnosticSha256: string;
}

export type ExactModelInvocationCaptureEvent =
  | { kind: "envelope"; payload: ModelContextEnvelopeReceipt }
  | { kind: "adapter"; payload: ModelAdapterReceiptV2 }
  | { kind: "invocation"; payload: ModelInvocationCapsuleReceipt }
  | { kind: "unavailable"; payload: ModelInvocationCaptureUnavailable }
  | { kind: "cache_projection"; payload: ReturnType<PromptCacheProjection["observe"]> };

export interface ExactModelInvocationCaptureInput {
  capsules: Pick<ModelInvocationCapsuleStore, "put">;
  /** The actual ledger container. Child ownership belongs in its event envelope. */
  source: { threadId: string; runId: string };
  model: Model<Api>;
  context: Context;
  options: SimpleStreamOptions | undefined;
  turnIndex: number;
  purpose: ModelInvocationPurpose;
  cacheScope: object;
  cacheScopeKind?: ToolSurfaceRevisionScope;
  phase?: string;
  emit(event: ExactModelInvocationCaptureEvent): Promise<void>;
  afterAdapter?(input: {
    envelope: ModelContextEnvelopeReceipt;
    adapter: ModelAdapterReceiptV2;
  }): Promise<void>;
}

const cacheProjections = new WeakMap<object, Map<string, PromptCacheProjection>>();

/** Capture exactly the supplied context. Event naming, owner binding and any
 * compiled-prompt receipt stay with the caller, including capture-failure events. */
export async function captureExactModelInvocation(
  original: ExactModelInvocationCaptureInput,
): Promise<{ context: Context; envelope: ModelContextEnvelopeReceipt }> {
  const input = { ...original, source: { ...original.source }, ...snapshotModelInvocation(original) };
  const { context } = input;
  const envelope = createModelContextEnvelopeReceipt({
    turnIndex: input.turnIndex,
    systemPrompt: context.systemPrompt ?? "",
    messages: context.messages,
    tools: context.tools ?? [],
  });
  await input.emit({ kind: "envelope", payload: envelope });
  await capturePrivateInvocation(input, envelope);
  await input.emit({
    kind: "cache_projection",
    payload: cacheProjection(input.cacheScope, input.phase ?? input.purpose, input.cacheScopeKind).observe({
      turnIndex: input.turnIndex,
      contextEnvelopeSha256: envelope.contentSha256,
      context,
      invocationIdentitySha256: sha256(canonicalJson({
        model: input.model,
        adapter: modelAdapterReceipt(input.model, input.options),
      })),
    }),
  });
  return { context, envelope };
}

async function capturePrivateInvocation(
  input: ExactModelInvocationCaptureInput,
  envelope: ModelContextEnvelopeReceipt,
): Promise<void> {
  try {
    const adaptedOptions = applyModelAdapterOptions(input.model, input.options);
    const adapter = modelAdapterReceipt(input.model, input.options);
    await input.emit({ kind: "adapter", payload: adapter });
    await input.afterAdapter?.({ envelope, adapter });
    const receipt = await input.capsules.put({
      sourceThreadId: input.source.threadId,
      sourceRunId: input.source.runId,
      turnIndex: envelope.turnIndex,
      purpose: input.purpose,
      model: input.model,
      contextEnvelopeSha256: envelope.contentSha256,
      context: input.context,
      ...(adaptedOptions ? { options: adaptedOptions } : {}),
    });
    await input.emit({ kind: "invocation", payload: receipt });
  } catch (error) {
    await input.emit({
      kind: "unavailable",
      payload: {
        schemaVersion: 1,
        turnIndex: envelope.turnIndex,
        purpose: input.purpose,
        model: `${input.model.provider}/${input.model.id}`,
        contextEnvelopeSha256: envelope.contentSha256,
        reason: captureFailureReason(error),
        diagnosticSha256: sha256(errorMessage(error)),
      },
    });
  }
}

function cacheProjection(
  scope: object,
  phase: string,
  kind: ToolSurfaceRevisionScope = "run_and_invocation_purpose",
): PromptCacheProjection {
  let phases = cacheProjections.get(scope);
  if (!phases) {
    phases = new Map();
    cacheProjections.set(scope, phases);
  }
  const key = `${kind}:${phase}`;
  let projection = phases.get(key);
  if (!projection) {
    projection = new PromptCacheProjection(kind);
    phases.set(key, projection);
  }
  return projection;
}

function captureFailureReason(error: unknown): "limit" | "storage" | "invalid" {
  const message = errorMessage(error);
  if (/\b(?:byte|count|limit|exceeds)\b/iu.test(message)) return "limit";
  if (
    error && typeof error === "object" && "code" in error &&
    ["EACCES", "EDQUOT", "ENOSPC", "EROFS"].includes(String(error.code))
  ) return "storage";
  return "invalid";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
