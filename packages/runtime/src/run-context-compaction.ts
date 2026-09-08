import type { Context } from "@earendil-works/pi-ai";
import type { RunRecord } from "@napier/contracts";
import { canonicalJson, sha256 } from "./ed25519.js";
import { emitBestEffort, type EventSink } from "./event-sink.js";
import { measureModelContextWithProvider } from "./model-context-token-meter.js";
import type { RunBudgetTracker } from "./run-budget.js";
import {
  applyRunContextCheckpoint,
  checkpointHasResponseBinding,
  checkpointMatchesSource,
  createRunContextCheckpoint,
  parseRunContextCheckpoint,
  contextEvidenceRecord,
  RUN_CONTEXT_COMPACTED_EVENT,
  RUN_CONTEXT_COMPACTION_FAILED_EVENT,
  RUN_CONTEXT_PROJECTED_EVENT,
  type RunContextCheckpoint,
} from "./run-context-checkpoint.js";
import {
  completeContextUnits,
  contextCorrespondsToSource,
  contextUnitEvidence,
  pinnedContextUsers,
} from "./run-context-compaction-boundary.js";
import {
  invokeRunContextCompactor,
  prepareRunCompactionRequest,
  runCompactionRequestFits,
  type RunCompactionHost,
} from "./run-context-compaction-model.js";
import type {
  RunContextCompactionInput,
  RunContextCompactionPort,
  RunContextCompactionProjection,
} from "./run-context-compaction-types.js";
import { modelContextMessageSetSha256 } from "./token-meter-content.js";

const TRIGGER_RATIO = 0.8;
const TARGET_RATIO = 0.6;

/** Owns a Run's model working set; never edits the transcript or resets Run budgets. */
export class RunContextCompactor implements RunContextCompactionPort {
  private checkpoint: RunContextCheckpoint | undefined;
  private hydrated = false;
  private readonly failedPrefixes = new Set<string>();

  constructor(
    private readonly host: RunCompactionHost,
    private readonly run: RunRecord,
    private readonly budget: RunBudgetTracker,
    private readonly nextTurnIndex: () => number,
    private readonly onEvent?: EventSink,
  ) {}

  async project(
    input: RunContextCompactionInput,
  ): Promise<RunContextCompactionProjection> {
    input.options.signal?.throwIfAborted();
    await this.hydrate(input.sourceContext);
    if (
      this.checkpoint &&
      !checkpointMatchesSource(
        this.checkpoint,
        this.run.id,
        input.sourceContext,
      )
    )
      this.checkpoint = undefined;
    // Extensions may transform a request. Only compact a surface whose message
    // identities are still bound to the durable source, including on recovery.
    let base = input.context;
    if (!contextCorrespondsToSource(input.sourceContext, base)) {
      const restored =
        this.checkpoint &&
        applyRunContextCheckpoint(input.prunedContext, this.checkpoint);
      if (!restored || digest(restored) !== digest(base))
        return { context: input.context, recoveryReduced: false };
      base = input.prunedContext;
    }
    let active = this.checkpoint
      ? applyRunContextCheckpoint(base, this.checkpoint)
      : base;
    const original = await this.measure(input, input.context);
    let measurement = await this.measure(input, active);
    const availableInput = Math.max(
      0,
      input.model.contextWindow -
        measurement.outputReserveTokens -
        measurement.reasoningReserveTokens -
        measurement.safetyReserveTokens,
    );
    const force = input.recoveryAttempt === 1;
    if (
      force ||
      measurement.estimatedInputTokens > availableInput * TRIGGER_RATIO
    ) {
      const end = await this.selectEnd(input, base, availableInput, force);
      // Each successful batch consumes at least one new complete execution
      // unit and shrinks the input. The finite source plus Run budget bound
      // this loop without abandoning a large source after an arbitrary count.
      while (end > (this.checkpoint?.sourceMessageCount ?? 0)) {
        const batch = await this.prepareBatch(input, base, end);
        if (!batch) break;
        const sourcePrefix = input.sourceContext.messages.slice(0, batch.end);
        const prefixHash = modelContextMessageSetSha256(sourcePrefix);
        if (this.failedPrefixes.has(prefixHash)) break;
        try {
          const result = await invokeRunContextCompactor({
            host: this.host,
            run: this.run,
            budget: this.budget,
            model: input.model,
            request: batch.request,
            nextTurnIndex: this.nextTurnIndex,
            ...(this.onEvent ? { onEvent: this.onEvent } : {}),
          });
          const candidate = createRunContextCheckpoint({
            runId: this.run.id,
            sourceMessageCount: batch.end,
            sourceMessageSetSha256: prefixHash,
            pinnedUserMessageSetSha256: modelContextMessageSetSha256(
              pinnedContextUsers(sourcePrefix),
            ),
            parentCheckpointSha256: this.checkpoint?.contentSha256 ?? "",
            summary: result.summary,
            modelContextEnvelopeSha256: result.envelopeSha256,
            responseTextSha256: result.responseTextSha256,
          });
          const next = applyRunContextCheckpoint(base, candidate);
          const nextMeasurement = await this.measure(input, next);
          // Reject verbose summaries and prevent no-reduction compaction loops.
          if (
            measurement.estimatedInputTokens -
              nextMeasurement.estimatedInputTokens <
            128
          )
            throw new Error(
              "Run context summary did not reduce input by at least 128 tokens",
            );
          input.options.signal?.throwIfAborted();
          this.budget.assertCanStartAuxiliaryCall();
          await this.record(RUN_CONTEXT_COMPACTED_EVENT, candidate);
          this.checkpoint = candidate;
          active = next;
          measurement = nextMeasurement;
          if (measurement.estimatedInputTokens <= availableInput * TARGET_RATIO)
            break;
        } catch (error) {
          this.failedPrefixes.add(prefixHash);
          await this.record(RUN_CONTEXT_COMPACTION_FAILED_EVENT, {
            kind: "napier.run-context-compaction-failure",
            schemaVersion: 1,
            runId: this.run.id,
            sourceMessageSetSha256: prefixHash,
            diagnosticSha256: sha256(
              error instanceof Error ? error.message : String(error),
            ),
          });
          input.options.signal?.throwIfAborted();
          this.budget.assertCanStartAuxiliaryCall();
          break;
        }
      }
    }
    if (!this.checkpoint || digest(active) === digest(input.context))
      return {
        context: input.context,
        recoveryReduced: false,
        preserveUserMessages: Boolean(this.checkpoint),
      };
    const pinnedUsersSha256 = modelContextMessageSetSha256(
      pinnedContextUsers(input.context.messages),
    );
    if (
      modelContextMessageSetSha256(pinnedContextUsers(active.messages)) !==
      pinnedUsersSha256
    )
      throw new Error("Run context compaction changed protected user messages");
    const receipt = await this.record(RUN_CONTEXT_PROJECTED_EVENT, {
      kind: "napier.run-context-projection",
      schemaVersion: 1,
      runId: this.run.id,
      checkpointSha256: this.checkpoint.contentSha256,
      modelAttempt: input.modelAttempt,
      recoveryAttempt: input.recoveryAttempt,
      originalMessageCount: input.context.messages.length,
      originalMessageSetSha256: digest(input.context),
      activeMessageCount: active.messages.length,
      activeMessageSetSha256: digest(active),
      pinnedUserMessageSetSha256: pinnedUsersSha256,
      originalEstimatedInputTokens: original.estimatedInputTokens,
      activeEstimatedInputTokens: measurement.estimatedInputTokens,
    });
    return {
      context: active,
      receiptSha256: receipt,
      preserveUserMessages: true,
      recoveryReduced:
        force &&
        measurement.estimatedInputTokens < original.estimatedInputTokens,
    };
  }

  private measure(input: RunContextCompactionInput, context: Context) {
    return measureModelContextWithProvider(
      {
        model: input.model,
        context,
        options: input.options,
        compiledPrompt: input.compiledPrompt,
        recoveryAttempt: input.recoveryAttempt,
      },
      input.tokenMeters,
    );
  }

  private async selectEnd(
    input: RunContextCompactionInput,
    base: Context,
    available: number,
    force: boolean,
  ): Promise<number> {
    const units = completeContextUnits(base.messages).filter(
      (unit) => !unit.user,
    );
    if (units.length < 2) return 0;
    const last = units.at(-1)!;
    const irreducible = await this.measure(input, {
      ...base,
      messages: [
        ...pinnedContextUsers(base.messages.slice(0, last.start)),
        ...base.messages.slice(last.start),
      ],
    });
    if (irreducible.estimatedTotalTokens > input.model.contextWindow) return 0;
    const measured = await this.measure(input, base);
    const retainedBudget = force
      ? 0
      : Math.max(512, Math.min(8_192, available * 0.2));
    let retained = 0;
    let end = base.messages.length;
    for (let index = units.length - 1; index >= 0; index--) {
      const unit = units[index]!;
      const cost = measured.messages.items
        .slice(unit.start, unit.end)
        .reduce((total, item) => total + item.estimatedTokens, 0);
      if (index < units.length - 1 && retained + cost > retainedBudget) break;
      retained += cost;
      end = unit.start;
    }
    return end;
  }

  private async prepareBatch(
    input: RunContextCompactionInput,
    base: Context,
    end: number,
  ) {
    const start = this.checkpoint?.sourceMessageCount ?? 0;
    const evidence: string[] = [];
    let selectedEnd = start;
    let executionUnits = 0;
    let request: ReturnType<typeof prepareRunCompactionRequest> | undefined;
    const deadline = AbortSignal.timeout(
      Math.max(1, this.budget.remainingTimeoutMs()),
    );
    const signal = input.options.signal
      ? AbortSignal.any([input.options.signal, deadline])
      : deadline;
    for (const unit of completeContextUnits(base.messages)) {
      if (unit.start < start || unit.end > end) continue;
      const candidate = prepareRunCompactionRequest({
        model: input.model,
        options: input.options,
        ...(this.checkpoint ? { previous: this.checkpoint.summary } : {}),
        evidence: [...evidence, contextUnitEvidence(base.messages, unit)],
        signal,
      });
      if (
        !(await runCompactionRequestFits(
          input.model,
          candidate,
          input.tokenMeters,
        ))
      )
        break;
      evidence.push(contextUnitEvidence(base.messages, unit));
      selectedEnd = unit.end;
      executionUnits += Number(!unit.user);
      request = candidate;
    }
    return request && executionUnits > 0
      ? { end: selectedEnd, request }
      : undefined;
  }

  private async hydrate(source: Context): Promise<void> {
    if (this.hydrated) return;
    const events = await this.host.store.listRunEvents(this.run.id, undefined, [
      RUN_CONTEXT_COMPACTED_EVENT,
      RUN_CONTEXT_COMPACTION_FAILED_EVENT,
      "model.response",
    ]);
    const verified = new Map<string, RunContextCheckpoint>();
    for (const event of events) {
      if (event.type === RUN_CONTEXT_COMPACTION_FAILED_EVENT) {
        const { contentSha256, ...content } = contextEvidenceRecord(
          event.payload,
        );
        if (
          sha256(canonicalJson(content)) === contentSha256 &&
          typeof content["sourceMessageSetSha256"] === "string"
        )
          this.failedPrefixes.add(content["sourceMessageSetSha256"]);
      } else if (event.type === RUN_CONTEXT_COMPACTED_EVENT) {
        const checkpoint = parseRunContextCheckpoint(event.payload);
        const parent = checkpoint?.parentCheckpointSha256
          ? verified.get(checkpoint.parentCheckpointSha256)
          : undefined;
        if (
          checkpoint &&
          (!checkpoint.parentCheckpointSha256 ||
            (parent &&
              parent.sourceMessageCount < checkpoint.sourceMessageCount)) &&
          checkpointMatchesSource(checkpoint, this.run.id, source) &&
          checkpointHasResponseBinding(checkpoint, events, event.seq)
        ) {
          verified.set(checkpoint.contentSha256, checkpoint);
          this.checkpoint = checkpoint;
        }
      }
    }
    this.hydrated = true;
  }

  private async record(
    type:
      | typeof RUN_CONTEXT_COMPACTED_EVENT
      | typeof RUN_CONTEXT_COMPACTION_FAILED_EVENT
      | typeof RUN_CONTEXT_PROJECTED_EVENT,
    value: object,
  ): Promise<string> {
    const { contentSha256: _hash, ...content } = value as Record<
      string,
      unknown
    >;
    const contentSha256 = sha256(canonicalJson(content));
    const event = await this.host.store.appendEvent({
      threadId: this.run.threadId,
      runId: this.run.id,
      type,
      category: "model",
      visibility: "debug",
      payload: JSON.parse(JSON.stringify({ ...content, contentSha256 })),
    });
    await emitBestEffort(this.onEvent, event);
    return contentSha256;
  }
}

function digest(context: Context): string {
  return modelContextMessageSetSha256(context.messages);
}
