import type { Api, Model } from "@earendil-works/pi-ai";
import type { Usage } from "@napier/contracts";
import {
  type ApplyContextCompactionForkRequest,
  type ContextCompactionForkResult,
  type ContextCompactionPreview,
  type PreviewContextCompactionRequest,
  validateApplyContextCompactionForkRequest,
  validateContextCompactionPreview,
  validatePreviewContextCompactionRequest,
} from "@napier/contracts/context-compaction";

import { modelRefFromModel } from "./agent-model-projection.js";
import { hashContextEvents } from "./compaction.js";
import {
  appendContextCompactionRunStarted,
  contextCompactionRunTerminalEvent,
  ContextCompactionPreviewChangedError,
  materializeContextCompactionFork,
} from "./context-compaction-fork-materialization.js";
import { invokeContextCompactionPreviewModel } from "./context-compaction-preview-model.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import { createProcessLeaseOwnerId } from "./ids.js";
import { planManualContextCompaction } from "./manual-context-compaction.js";
import type { ModelInvocationCapsuleStore } from "./model-invocation-capsule-store.js";
import type { ModelRegistry } from "./models.js";
import type { LocalStore } from "./store.js";

const MAX_CACHED_PREVIEWS = 32;
const RUN_LEASE_TTL_MS = 60_000;
const RUN_LEASE_HEARTBEAT_MS = 20_000;

interface CachedPreview {
  preview: ContextCompactionPreview;
  auditedEventCount: number;
  auditedEventSetSha256: string;
}

export { ContextCompactionPreviewChangedError } from "./context-compaction-fork-materialization.js";

export class ContextCompactionPreviewUnavailableError extends Error {
  constructor() {
    super("Context compaction preview is unavailable; generate a new preview");
    this.name = "ContextCompactionPreviewUnavailableError";
  }
}

export class ContextCompactionWorkbenchService {
  private readonly previews = new Map<string, CachedPreview>();
  private readonly applying = new Set<string>();
  private readonly workerId = createProcessLeaseOwnerId("compact");

  constructor(
    private readonly store: LocalStore,
    private readonly models: ModelRegistry,
    private readonly capsules: ModelInvocationCapsuleStore,
  ) {}

  async preview(
    sourceThreadId: string,
    input: PreviewContextCompactionRequest,
    signal?: AbortSignal,
  ): Promise<ContextCompactionPreview> {
    const request = validatePreviewContextCompactionRequest(input);
    signal?.throwIfAborted();
    const model = await this.requireProviderModel(request.model);
    const sourceThread = this.store.getThread(sourceThreadId);
    const sourceEvents = await this.store.listEvents(sourceThreadId);
    const plan = planManualContextCompaction(
      sourceEvents,
      request.retainedMessageCount,
    );
    const sourceEventSetSha256 = hashContextEvents(sourceEvents);
    const leased = await this.store.createLeasedRun(
      {
        threadId: sourceThreadId,
        agentId: sourceThread.agentId,
        model: request.model,
        source: "context_compaction",
        executionMode: "context_compaction_single_call",
      },
      { ownerId: this.workerId, ttlMs: RUN_LEASE_TTL_MS },
    );
    const heartbeat = this.startHeartbeat(leased.run.id, leased.token);
    let usage: Usage | undefined;
    try {
      await this.assertSourceSnapshot(
        sourceThreadId,
        sourceEvents.length,
        sourceEventSetSha256,
      );
      await appendContextCompactionRunStarted(
        this.store,
        leased.run,
        request.model,
      );
      const fromSeq = plan.compactEvents[0]!.seq;
      const toSeq = plan.compactEvents.at(-1)!.seq;
      const retainedFromSeq = plan.recentEvents[0]!.seq;
      await this.store.appendEvent({
        threadId: sourceThreadId,
        runId: leased.run.id,
        type: "context.compaction.started",
        category: "model",
        visibility: "debug",
        payload: {
          fromSeq,
          toSeq,
          retainedFromSeq,
          sourceEventCount: plan.compactEvents.length,
          previewOnly: true,
        },
        admission: "run_active",
      });
      const result = await invokeContextCompactionPreviewModel({
        store: this.store,
        models: this.models,
        capsules: this.capsules,
        run: leased.run,
        model,
        messages: plan.compactEvents,
        continuity: plan.compactContinuityEvents,
        ...(signal ? { signal } : {}),
      });
      usage = result.usage;
      const content = {
        kind: "napier.context-compaction-preview" as const,
        schemaVersion: 1 as const,
        previewRunId: leased.run.id,
        sourceThreadId,
        sourceEventCount: sourceEvents.length,
        sourceEventSetSha256,
        fromSeq,
        toSeq,
        retainedFromSeq,
        sourceMessageCount: plan.compactEvents.length,
        sourceMessageSha256: hashContextEvents(plan.compactEvents),
        continuityEventCount: plan.compactContinuityEvents.length,
        continuitySha256: hashContextEvents(plan.compactContinuityEvents),
        retainedMessageCount: request.retainedMessageCount,
        model: modelRefFromModel(model),
        ...result.compaction,
      };
      const preview = validateContextCompactionPreview({
        ...content,
        previewSha256: sha256(canonicalJson(content)),
      });
      await this.store.appendEvent({
        threadId: sourceThreadId,
        runId: leased.run.id,
        type: "context.compaction.previewed",
        category: "model",
        visibility: "user",
        payload: {
          schemaVersion: 1,
          previewRunId: preview.previewRunId,
          sourceThreadId,
          sourceEventCount: preview.sourceEventCount,
          sourceEventSetSha256: preview.sourceEventSetSha256,
          fromSeq: preview.fromSeq,
          toSeq: preview.toSeq,
          retainedFromSeq: preview.retainedFromSeq,
          sourceMessageCount: preview.sourceMessageCount,
          sourceMessageSha256: preview.sourceMessageSha256,
          continuityEventCount: preview.continuityEventCount,
          continuitySha256: preview.continuitySha256,
          retainedMessageCount: preview.retainedMessageCount,
          model: `${preview.model.provider}/${preview.model.id}`,
          previewSha256: preview.previewSha256,
          contentRedacted: true,
        },
        admission: "run_active",
      });
      await this.store.finishRun(leased.run.id, "completed", {
        usage,
        leaseToken: leased.token,
        terminalEvent: contextCompactionRunTerminalEvent("completed"),
      });
      const auditedEvents = await this.store.listEvents(sourceThreadId);
      this.cache({
        preview,
        auditedEventCount: auditedEvents.length,
        auditedEventSetSha256: hashContextEvents(auditedEvents),
      });
      return preview;
    } catch (error) {
      await this.failPreview(
        leased.run.id,
        sourceThreadId,
        leased.token,
        error,
      );
      throw error;
    } finally {
      clearInterval(heartbeat);
    }
  }

  async applyFork(
    sourceThreadId: string,
    input: ApplyContextCompactionForkRequest,
  ): Promise<ContextCompactionForkResult> {
    const request = validateApplyContextCompactionForkRequest(input);
    const cached = this.previews.get(request.expectedPreviewSha256);
    if (!cached || cached.preview.sourceThreadId !== sourceThreadId) {
      throw new ContextCompactionPreviewUnavailableError();
    }
    if (this.applying.has(request.expectedPreviewSha256)) {
      throw new ContextCompactionPreviewUnavailableError();
    }
    this.applying.add(request.expectedPreviewSha256);
    this.previews.delete(request.expectedPreviewSha256);
    const source = this.store.getThread(sourceThreadId);
    let sourceLease:
      | Awaited<ReturnType<LocalStore["createLeasedRun"]>>
      | undefined;
    try {
      await this.assertSourceSnapshot(
        sourceThreadId,
        cached.auditedEventCount,
        cached.auditedEventSetSha256,
      );
      sourceLease = await this.store.createLeasedRun(
        {
          threadId: sourceThreadId,
          agentId: source.agentId,
          model: cached.preview.model,
          source: "context_compaction",
          executionMode: "context_compaction_single_call",
        },
        { ownerId: this.workerId, ttlMs: RUN_LEASE_TTL_MS },
      );
      await this.assertSourceSnapshot(
        sourceThreadId,
        cached.auditedEventCount,
        cached.auditedEventSetSha256,
      );
      await appendContextCompactionRunStarted(
        this.store,
        sourceLease.run,
        cached.preview.model,
      );
      const materialized = await materializeContextCompactionFork({
        store: this.store,
        sourceThreadId,
        sourceEventCount: cached.auditedEventCount,
        preview: cached.preview,
        workerId: this.workerId,
        ...(request.title ? { title: request.title } : {}),
      });
      await this.store.appendEvent({
        threadId: sourceThreadId,
        runId: sourceLease.run.id,
        type: "context.compaction.forked",
        category: "model",
        visibility: "user",
        payload: {
          schemaVersion: 1,
          sourceThreadId,
          targetThreadId: materialized.targetThreadId,
          previewSha256: cached.preview.previewSha256,
          checkpointId: materialized.checkpoint.checkpointId,
          sourceEventSetSha256: cached.preview.sourceEventSetSha256,
        },
        admission: "run_active",
      });
      await this.store.finishRun(sourceLease.run.id, "completed", {
        leaseToken: sourceLease.token,
        terminalEvent: contextCompactionRunTerminalEvent("completed"),
      });
      sourceLease = undefined;
      return {
        kind: "napier.context-compaction-fork-result",
        schemaVersion: 1,
        sourceThreadId,
        targetThreadId: materialized.targetThreadId,
        previewSha256: cached.preview.previewSha256,
        checkpoint: materialized.checkpoint,
      };
    } catch (error) {
      if (sourceLease) {
        await this.store
          .appendEvent({
            threadId: sourceThreadId,
            runId: sourceLease.run.id,
            type: "context.compaction.failed",
            category: "model",
            visibility: "user",
            payload: {
              applyFork: true,
              previewSha256: cached.preview.previewSha256,
              diagnosticSha256: sha256(
                error instanceof Error ? error.message : String(error),
              ),
              message: error instanceof Error ? error.message : String(error),
            },
            admission: "run_active",
          })
          .catch(() => undefined);
        await this.store
          .finishRun(sourceLease.run.id, "failed", {
            error: "Context compaction fork failed",
            leaseToken: sourceLease.token,
            terminalEvent: contextCompactionRunTerminalEvent("failed"),
          })
          .catch(() => undefined);
      }
      throw error;
    } finally {
      this.applying.delete(request.expectedPreviewSha256);
    }
  }

  private async requireProviderModel(
    ref: PreviewContextCompactionRequest["model"],
  ): Promise<Model<Api>> {
    const model = await this.models.resolveConfigured(ref);
    if (!model) {
      throw new Error("Context compaction requires a provider-backed model");
    }
    return model;
  }

  private async assertSourceSnapshot(
    threadId: string,
    expectedCount: number,
    expectedSha256: string,
  ): Promise<void> {
    const events = await this.store.listEvents(threadId);
    if (
      events.length !== expectedCount ||
      hashContextEvents(events) !== expectedSha256
    ) {
      throw new ContextCompactionPreviewChangedError();
    }
  }

  private async failPreview(
    runId: string,
    threadId: string,
    leaseToken: string,
    error: unknown,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    await this.store
      .appendEvent({
        threadId,
        runId,
        type: "context.compaction.failed",
        category: "model",
        visibility: "user",
        payload: {
          previewOnly: true,
          diagnosticSha256: sha256(message),
          message,
        },
        admission: "run_active",
      })
      .catch(() => undefined);
    await this.store
      .finishRun(runId, "failed", {
        error: "Context compaction preview failed",
        leaseToken,
        terminalEvent: contextCompactionRunTerminalEvent("failed"),
      })
      .catch(() => undefined);
  }

  private startHeartbeat(
    runId: string,
    leaseToken: string,
  ): ReturnType<typeof setInterval> {
    return setInterval(() => {
      void this.store
        .renewRunLease(runId, leaseToken, RUN_LEASE_TTL_MS)
        .catch(() => undefined);
    }, RUN_LEASE_HEARTBEAT_MS);
  }

  private cache(entry: CachedPreview): void {
    this.previews.set(entry.preview.previewSha256, entry);
    while (this.previews.size > MAX_CACHED_PREVIEWS) {
      const oldest = this.previews.keys().next().value as string | undefined;
      if (!oldest) break;
      this.previews.delete(oldest);
    }
  }
}
