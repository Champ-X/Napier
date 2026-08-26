import type { RunRecord } from "@napier/contracts";

import { toJsonValue } from "./agent-runtime-utils.js";
import type { AgentModelCallPreparation } from "./agent-model-stream-lifecycle.js";
import type { EventSink } from "./event-sink.js";
import {
  CONTEXT_PROJECTION_EVENT,
  createContextProjectionReceipt,
  type ContextProjectionPreparationReceipt,
} from "./context-projection-receipt.js";
import {
  type AgentModelCallFinalization,
  type ComposableAgentModelCallPipeline,
} from "./kernel-model-call-pipeline.js";
import { hydrateTokenCalibrationRegistry } from "./model-context-token-calibration.js";
import {
  ModelContextWindowBudgetError,
  projectModelContextTokenPressureWithProvider,
} from "./model-context-token-pressure.js";
import {
  modelContextMessageSetSha256,
  modelContextToolDefinitionSetSha256,
} from "./token-meter-content.js";
import type { LocalStore } from "./store.js";
import { pruneToolResultContext } from "./tool-result-context-pruner.js";
import type { TokenMeterRegistry } from "./token-meter-provider.js";

export const CONTEXT_PROJECTION_EXTENSION_ID =
  "napier.context-projection-service";
export const CONTEXT_PROJECTION_PREPARE_EXTENSION_ID =
  "napier.context-projection-service.prepare";
export const CONTEXT_PROJECTION_EXTENSION_OWNER = "kernel.context";

export class ContextProjectionService {
  private readonly preparations = new WeakMap<
    RunRecord,
    Map<string, ContextProjectionPreparationReceipt>
  >();

  constructor(
    private readonly store: LocalStore,
    private readonly tokenMeters: TokenMeterRegistry,
  ) {}

  install(pipeline: ComposableAgentModelCallPipeline): () => void {
    const removePrepare = pipeline.use(
      {
        id: CONTEXT_PROJECTION_PREPARE_EXTENSION_ID,
        order: -400,
        prepare: (call) => this.prepare(call),
      },
      CONTEXT_PROJECTION_EXTENSION_OWNER,
    );
    const removeFinalize = pipeline.use(
      {
        id: CONTEXT_PROJECTION_EXTENSION_ID,
        order: 10_000,
        finalize: (call) => this.finalize(call),
      },
      CONTEXT_PROJECTION_EXTENSION_OWNER,
    );
    return () => {
      removeFinalize();
      removePrepare();
    };
  }

  private async prepare(call: Readonly<AgentModelCallPreparation>) {
    const pruning = pruneToolResultContext(call.context, call.attempt);
    this.preparationMap(call.run).set(projectionKey(call), {
      durableMessageCount: call.context.messages.length,
      durableMessageSetSha256: modelContextMessageSetSha256(
        call.context.messages,
      ),
      prePruningMessageCount: call.context.messages.length,
      prePruningMessageSetSha256: modelContextMessageSetSha256(
        call.context.messages,
      ),
      postPruningMessageCount: pruning.context.messages.length,
      postPruningMessageSetSha256: modelContextMessageSetSha256(
        pruning.context.messages,
      ),
      pruning: pruning.receipt,
    });
    await appendProjectionEvent(
      this.store,
      call,
      "model.context.tool-results.pruned",
      pruning.receipt,
    );
    return { context: pruning.context };
  }

  private async finalize(call: Readonly<AgentModelCallFinalization>) {
    const prepared = this.preparations.get(call.run)?.get(projectionKey(call));
    if (!prepared) {
      throw new Error("Context Projection preparation is unavailable");
    }
    await hydrateTokenCalibrationRegistry(this.store, this.tokenMeters);
    const projection = await projectModelContextTokenPressureWithProvider(
      {
        model: call.model,
        context: call.context,
        options: call.options,
        compiledPrompt: call.compiledPrompt,
        modelAttempt: call.attempt,
        recoveryAttempt: call.recoveryAttempt,
      },
      this.tokenMeters,
    );
    await appendProjectionEvent(
      this.store,
      call,
      "model.context.token_pressure",
      projection.receipt,
    );
    const receipt = createContextProjectionReceipt({
      provider: call.model.provider,
      model: call.model.id,
      modelAttempt: call.attempt,
      recoveryAttempt: call.recoveryAttempt,
      toolCount: call.context.tools?.length ?? 0,
      toolDefinitionSetSha256: modelContextToolDefinitionSetSha256(
        call.context.tools ?? [],
      ),
      compiledPrompt: call.compiledPrompt,
      prepared,
      pressure: projection.receipt,
    });
    await appendProjectionEvent(
      this.store,
      call,
      CONTEXT_PROJECTION_EVENT,
      receipt,
    );
    if (projection.receipt.status === "unavailable") {
      throw new ModelContextWindowBudgetError(projection.receipt);
    }
    return { context: projection.context };
  }

  private preparationMap(
    run: RunRecord,
  ): Map<string, ContextProjectionPreparationReceipt> {
    const current = this.preparations.get(run);
    if (current) return current;
    const created = new Map<string, ContextProjectionPreparationReceipt>();
    this.preparations.set(run, created);
    return created;
  }
}

export function installContextProjectionService(
  pipeline: ComposableAgentModelCallPipeline,
  store: LocalStore,
  tokenMeters: TokenMeterRegistry,
): () => void {
  return new ContextProjectionService(store, tokenMeters).install(pipeline);
}

async function appendProjectionEvent(
  store: LocalStore,
  call: { run: RunRecord; onEvent?: EventSink },
  type:
    | typeof CONTEXT_PROJECTION_EVENT
    | "model.context.tool-results.pruned"
    | "model.context.token_pressure",
  receipt: object,
): Promise<void> {
  const event = await store.appendEvent({
    threadId: call.run.threadId,
    runId: call.run.id,
    type,
    category: "model",
    visibility: "debug",
    payload: toJsonValue(receipt),
  });
  if (!call.onEvent) return;
  try {
    await call.onEvent(event);
  } catch {
    // Durable projection evidence survives a disconnected observer.
  }
}

function projectionKey(
  call: Pick<AgentModelCallPreparation, "attempt" | "model">,
): string {
  return `${String(call.attempt)}:${call.model.provider}:${call.model.id}`;
}
