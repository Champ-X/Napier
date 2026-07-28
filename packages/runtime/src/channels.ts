import type {
  InboundDeadLetterRetryApplyResult,
  InboundDeadLetterRetryCandidate,
  InboundDeadLetterRetryPreview,
  InboundDelivery,
  InboundMessageRequest,
  InboundReceipt,
  JsonValue,
} from "@napier/contracts";

import { AgentRuntime } from "./agent-runtime.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import { createId } from "./ids.js";
import { createInboundDeadLetterRetryPreview } from "./inbound-dead-letters.js";
import { LocalStore } from "./store.js";

const DEFAULT_SWEEP_MS = 2_000;
const MAX_RETRY_DELAY_MS = 5 * 60_000;

export interface ChannelServiceOptions {
  sweepMs?: number;
}

export class ChannelService {
  private timer: ReturnType<typeof setInterval> | undefined;
  private draining: Promise<void> | undefined;

  constructor(
    readonly store: LocalStore,
    readonly runtime: AgentRuntime,
    options: ChannelServiceOptions = {},
  ) {
    const sweepMs = options.sweepMs ?? DEFAULT_SWEEP_MS;
    if (!Number.isInteger(sweepMs) || sweepMs < 250 || sweepMs > 60_000) {
      throw new Error("Channel sweep must be from 250 to 60000 ms");
    }
    this.sweepMs = sweepMs;
  }

  private readonly sweepMs: number;

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(
      () => void this.drain().catch(() => undefined),
      this.sweepMs,
    );
    this.timer.unref?.();
    void this.drain().catch(() => undefined);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.draining) await this.draining;
  }

  async accept(
    channelId: string,
    token: string,
    request: InboundMessageRequest,
  ): Promise<InboundReceipt> {
    const receipt = await this.store.acceptInboundDelivery(
      channelId,
      token,
      request,
    );
    if (!receipt.duplicate) {
      await this.record(receipt.delivery.id, "channel.delivery.accepted", {
        status: receipt.delivery.status,
        idempotencyFingerprint: receipt.delivery.idempotencyFingerprint,
        maxAttempts: receipt.delivery.maxAttempts,
        retryBaseMs: receipt.delivery.retryBaseMs,
      });
      void this.drain().catch(() => undefined);
    }
    return receipt;
  }

  async retry(channelId: string, deliveryId: string): Promise<InboundDelivery> {
    const delivery = await this.store.retryInboundDelivery(
      channelId,
      deliveryId,
    );
    await this.record(delivery.id, "channel.delivery.retry.requested", {
      status: delivery.status,
      attemptCount: delivery.attemptCount,
      maxAttempts: delivery.maxAttempts,
      nextAttemptAt: delivery.nextAttemptAt ?? "",
    });
    void this.drain().catch(() => undefined);
    return delivery;
  }

  previewDeadLetterRetry(
    channelId: string,
    artifact: unknown,
  ): InboundDeadLetterRetryPreview {
    this.store.getInboundChannel(channelId);
    return createInboundDeadLetterRetryPreview(
      artifact,
      this.store.listInboundDeliveries(channelId),
      { expectedChannelId: channelId },
    );
  }

  async retryDeadLetters(
    channelId: string,
    artifact: unknown,
    expectedPreviewSha256: string,
    confirmReplay: boolean,
  ): Promise<InboundDeadLetterRetryApplyResult> {
    if (!confirmReplay) {
      throw new Error("Bulk inbound delivery retry requires confirmation");
    }
    const preview = this.previewDeadLetterRetry(channelId, artifact);
    if (preview.contentSha256 !== expectedPreviewSha256) {
      throw new Error("Dead-letter retry preview has changed");
    }
    if (preview.verificationStatus !== "valid") {
      throw new Error("Dead-letter retry requires a valid export artifact");
    }
    const retried: InboundDelivery[] = [];
    const skipped: InboundDeadLetterRetryCandidate[] = preview.candidates
      .filter((candidate) => candidate.status !== "retryable")
      .map((candidate) => structuredClone(candidate));
    for (const candidate of preview.candidates.filter(
      (item) => item.status === "retryable",
    )) {
      try {
        const delivery = await this.store.retryInboundDelivery(
          channelId,
          candidate.deliveryId,
        );
        await this.record(delivery.id, "channel.delivery.retry.requested", {
          status: delivery.status,
          attemptCount: delivery.attemptCount,
          maxAttempts: delivery.maxAttempts,
          nextAttemptAt: delivery.nextAttemptAt ?? "",
          source: "dead_letter_bulk",
          previewSha256: preview.contentSha256,
        });
        retried.push(delivery);
      } catch (error) {
        skipped.push({
          ...candidate,
          status: "state_changed",
          diagnostics: [safeError(error)],
        });
      }
    }
    const content = {
      schemaVersion: 1 as const,
      channelId,
      previewSha256: preview.contentSha256,
      ...(preview.artifactSha256
        ? { artifactSha256: preview.artifactSha256 }
        : {}),
      previewCandidateSetSha256: preview.candidateSetSha256,
      previewRetryableDeliveryIdsSha256: preview.retryableDeliveryIdsSha256,
      previewBlockedDeliveryIdsSha256: preview.blockedDeliveryIdsSha256,
      retriedCount: retried.length,
      skippedCount: skipped.length,
      retriedDeliveryIdsSha256: hashDeliveryIds(
        retried.map((delivery) => delivery.id),
      ),
      skippedDeliveryIdsSha256: hashDeliveryIds(
        skipped.map((candidate) => candidate.deliveryId),
      ),
      deliveries: retried,
      skipped,
    };
    void this.drain().catch(() => undefined);
    return {
      ...content,
      contentSha256: sha256(canonicalJson(content)),
    };
  }

  drain(now = new Date()): Promise<void> {
    if (this.draining) return this.draining;
    const operation = this.runDrain(now).finally(() => {
      this.draining = undefined;
    });
    this.draining = operation;
    return operation;
  }

  private async runDrain(now: Date): Promise<void> {
    const ids = this.store.listRunnableInboundDeliveryIds(now);
    await Promise.all(ids.map((deliveryId) => this.execute(deliveryId, now)));
  }

  private async execute(deliveryId: string, now: Date): Promise<void> {
    const execution = await this.store.claimInboundDelivery(deliveryId, now);
    if (!execution) return;
    const { delivery } = execution;
    const attemptTriggerId = inboundDeliveryAttemptTriggerId(delivery);
    const existing = this.store.getRunByTriggerId(attemptTriggerId);
    if (existing) {
      await this.store.finishInboundDelivery(
        delivery.id,
        existing.status === "completed"
          ? { status: "completed", runId: existing.id }
          : {
              status: "failed",
              runId: existing.id,
              error: `Existing inbound run is ${existing.status}`,
            },
      );
      await this.record(
        delivery.id,
        "channel.delivery.deduplicated",
        {
          status: existing.status,
          runId: existing.id,
          attempt: delivery.attemptCount,
        },
        existing.id,
      );
      return;
    }
    await this.record(delivery.id, "channel.delivery.started", {
      status: "running",
      attempt: delivery.attemptCount,
      maxAttempts: delivery.maxAttempts,
      retryBaseMs: delivery.retryBaseMs,
    });
    try {
      await this.assertDeliveryModelAvailable(delivery, execution.model);
      const run = await this.runtime.runPrompt({
        threadId: delivery.threadId,
        text: execution.message,
        source: "channel",
        triggerId: attemptTriggerId,
        ...(execution.model ? { model: execution.model } : {}),
      });
      const completed = run.status === "completed";
      await this.store.finishInboundDelivery(
        delivery.id,
        completed
          ? { status: "completed", runId: run.id }
          : {
              status: "failed",
              runId: run.id,
              error: `Inbound run settled as ${run.status}`,
            },
      );
      await this.record(
        delivery.id,
        completed ? "channel.delivery.completed" : "channel.delivery.failed",
        {
          status: run.status,
          runId: run.id,
          attempt: delivery.attemptCount,
        },
        run.id,
      );
    } catch (error) {
      const existingRun = this.store.getRunByTriggerId(attemptTriggerId);
      const message = safeError(error);
      if (!existingRun) {
        const retry = await this.store.scheduleInboundDeliveryRetry(
          delivery.id,
          message,
          retryDelayMs(delivery.attemptCount, delivery.retryBaseMs),
          now,
        );
        await this.record(
          delivery.id,
          retry.status === "retrying"
            ? "channel.delivery.retry.scheduled"
            : "channel.delivery.retry.exhausted",
          {
            status: retry.status,
            error: message,
            attempt: delivery.attemptCount,
            maxAttempts: delivery.maxAttempts,
            retryBaseMs: delivery.retryBaseMs,
            nextAttemptAt: retry.nextAttemptAt ?? "",
          },
        );
        return;
      }
      await this.store.finishInboundDelivery(delivery.id, {
        status: "failed",
        runId: existingRun.id,
        error: message,
      });
      await this.record(
        delivery.id,
        "channel.delivery.failed",
        {
          status: "failed",
          error: message,
          runId: existingRun.id,
          attempt: delivery.attemptCount,
        },
        existingRun.id,
      );
    }
  }

  private async assertDeliveryModelAvailable(
    delivery: InboundDelivery,
    deliveryModel: InboundMessageRequest["model"] | undefined,
  ): Promise<void> {
    const thread = this.store.getThread(delivery.threadId);
    const agent = this.store.getAgent(thread.agentId);
    const model = deliveryModel ?? agent.model;
    await this.runtime.modelRegistry.resolveConfigured(model);
  }

  private async record(
    deliveryId: string,
    type: string,
    payload: Record<string, JsonValue>,
    runId?: string,
  ): Promise<void> {
    const delivery = this.store
      .listInboundDeliveries()
      .find((candidate) => candidate.id === deliveryId);
    if (!delivery) return;
    const channel = this.store.getInboundChannel(delivery.channelId);
    const deliveryEvidence: Record<string, JsonValue> = {
      ...(delivery.bodySha256 ? { bodySha256: delivery.bodySha256 } : {}),
      ...(delivery.adapterCatalogSha256
        ? { adapterCatalogSha256: delivery.adapterCatalogSha256 }
        : {}),
    };
    await this.store.appendEvent({
      threadId: delivery.threadId,
      runId: runId ?? createId("runctl"),
      type,
      category: "channel",
      visibility: "user",
      payload: {
        channelId: delivery.channelId,
        deliveryId,
        adapter: channel.adapter,
        channelRevision: channel.revision,
        ...payload,
        ...deliveryEvidence,
      },
    });
  }
}

function hashDeliveryIds(deliveryIds: readonly string[]): string {
  return sha256(canonicalJson([...deliveryIds].sort()));
}

export function inboundDeliveryAttemptTriggerId(
  delivery: Pick<InboundDelivery, "triggerId" | "attemptCount">,
): string {
  return delivery.attemptCount <= 1
    ? delivery.triggerId
    : `${delivery.triggerId}:attempt:${delivery.attemptCount}`;
}

function retryDelayMs(attemptCount: number, baseMs: number): number {
  return Math.min(
    baseMs * 2 ** Math.max(0, attemptCount - 1),
    MAX_RETRY_DELAY_MS,
  );
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}
