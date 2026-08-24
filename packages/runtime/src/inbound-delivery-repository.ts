import {
  type InboundDeadLetterExport,
  type InboundDelivery,
  type InboundDeliveryQualificationStatus,
  type InboundMessageRequest,
} from "@napier/contracts";
import { nowIso } from "./ids.js";
import {
  storeCanonicalJson as canonicalJson,
  storeSha256 as sha256,
} from "./store-hashing.js";
import type { ChannelDeliveryExecution } from "./store-port.js";

const MAX_INBOUND_RETRY_DELAY_MS = 24 * 60 * 60 * 1_000;

interface PersistedInboundDelivery extends InboundDelivery {
  idempotencySha256: string;
  message: string;
  model?: InboundMessageRequest["model"];
}

export type InboundExecution = ChannelDeliveryExecution;

function stripDeliverySecrets(
  delivery: PersistedInboundDelivery,
): InboundDelivery {
  const {
    idempotencySha256: _idempotencySha256,
    message: _message,
    model: _model,
    ...output
  } = structuredClone(delivery);
  return output;
}

function normalizeOptionalSha256(
  value: string | undefined,
  label: string,
): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
}

function inboundDeadLetterQualificationStatus(
  delivery: PersistedInboundDelivery,
  currentAdapterCatalogSha256: string,
): InboundDeliveryQualificationStatus {
  if (!delivery.bodySha256 || !delivery.adapterCatalogSha256) {
    return "evidence_missing";
  }
  return delivery.adapterCatalogSha256 === currentAdapterCatalogSha256
    ? "qualified"
    : "adapter_catalog_drift";
}

function inboundDeadLetterQualificationSummary(
  deliveries: ReadonlyArray<{
    qualificationStatus?: InboundDeliveryQualificationStatus;
  }>,
): {
  qualifiedCount: number;
  evidenceMissingCount: number;
  adapterCatalogDriftCount: number;
} {
  return deliveries.reduce(
    (summary, delivery) => {
      if (delivery.qualificationStatus === "qualified") {
        summary.qualifiedCount += 1;
      } else if (delivery.qualificationStatus === "evidence_missing") {
        summary.evidenceMissingCount += 1;
      } else if (delivery.qualificationStatus === "adapter_catalog_drift") {
        summary.adapterCatalogDriftCount += 1;
      }
      return summary;
    },
    {
      qualifiedCount: 0,
      evidenceMissingCount: 0,
      adapterCatalogDriftCount: 0,
    },
  );
}

import type { StoreRepositoryHost } from "./store-repository-host.js";

export class InboundDeliveryRepository {
  constructor(private readonly host: StoreRepositoryHost) {}

  listInboundDeliveries(channelId?: string): InboundDelivery[] {
    this.host.assertInitialized();
    return structuredClone(
      this.host.state.inboundDeliveries
        .filter((delivery) => !channelId || delivery.channelId === channelId)
        .map(stripDeliverySecrets)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    );
  }

  exportInboundDeadLetters(
    channelId: string,
    now = new Date(),
    currentAdapterCatalogSha256?: string,
  ): InboundDeadLetterExport {
    this.host.assertInitialized();
    if (!Number.isFinite(now.getTime())) {
      throw new Error("Dead-letter export time is invalid");
    }
    const normalizedCatalogSha256 = normalizeOptionalSha256(
      currentAdapterCatalogSha256,
      "Inbound adapter catalog SHA-256",
    );
    const channel = this.host.mutableInboundChannel(channelId);
    const deliveries = this.host.state.inboundDeliveries
      .filter(
        (delivery) =>
          delivery.channelId === channelId && delivery.status === "failed",
      )
      .sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          left.id.localeCompare(right.id),
      )
      .map((delivery) => ({
        deliveryId: delivery.id,
        threadId: delivery.threadId,
        idempotencyFingerprint: delivery.idempotencyFingerprint,
        triggerId: delivery.triggerId,
        attemptCount: delivery.attemptCount,
        maxAttempts: delivery.maxAttempts,
        retryBaseMs: delivery.retryBaseMs,
        retryDisposition:
          delivery.attemptCount < delivery.maxAttempts
            ? ("manual_retry_available" as const)
            : ("retry_exhausted" as const),
        ...(normalizedCatalogSha256
          ? {
              qualificationStatus: inboundDeadLetterQualificationStatus(
                delivery,
                normalizedCatalogSha256,
              ),
            }
          : {}),
        messageSha256: sha256(delivery.message),
        ...(delivery.bodySha256 ? { bodySha256: delivery.bodySha256 } : {}),
        ...(delivery.adapterCatalogSha256
          ? { adapterCatalogSha256: delivery.adapterCatalogSha256 }
          : {}),
        error: delivery.error ?? "Inbound delivery failed without an error.",
        ...(delivery.runId ? { runId: delivery.runId } : {}),
        createdAt: delivery.createdAt,
        ...(delivery.lastAttemptAt
          ? { lastAttemptAt: delivery.lastAttemptAt }
          : {}),
        ...(delivery.finishedAt ? { finishedAt: delivery.finishedAt } : {}),
      }));
    const qualificationSummary = normalizedCatalogSha256
      ? inboundDeadLetterQualificationSummary(deliveries)
      : undefined;
    const content = {
      schemaVersion: 1 as const,
      channel: {
        id: channel.id,
        name: channel.name,
        threadId: channel.threadId,
        status: channel.status,
        retryPolicy: structuredClone(channel.retryPolicy),
        revision: channel.revision,
      },
      ...(normalizedCatalogSha256
        ? { currentAdapterCatalogSha256: normalizedCatalogSha256 }
        : {}),
      ...(qualificationSummary ?? {}),
      deliveryCount: deliveries.length,
      deliveries,
    };
    return {
      ...content,
      exportedAt: now.toISOString(),
      contentSha256: sha256(canonicalJson(content)),
    };
  }

  async claimInboundDelivery(
    deliveryId: string,
    now = new Date(),
  ): Promise<InboundExecution | undefined> {
    this.host.assertInitialized();
    const timestamp = now.toISOString();
    return this.host.stateQueue.run(async () => {
      const delivery = this.host.mutableInboundDelivery(deliveryId);
      if (delivery.status !== "accepted" && delivery.status !== "retrying") {
        return undefined;
      }
      if (
        delivery.nextAttemptAt &&
        Date.parse(delivery.nextAttemptAt) > now.getTime()
      ) {
        return undefined;
      }
      const channel = this.host.mutableInboundChannel(delivery.channelId);
      if (channel.status !== "active") return undefined;
      const thread = this.host.mutableThread(delivery.threadId);
      if (thread.currentRunId) return undefined;
      delivery.status = "running";
      delivery.attemptCount += 1;
      delivery.startedAt ??= timestamp;
      delivery.lastAttemptAt = timestamp;
      delete delivery.nextAttemptAt;
      delete delivery.finishedAt;
      delete delivery.error;
      delivery.revision += 1;
      await this.host.persistState();
      return {
        delivery: structuredClone(stripDeliverySecrets(delivery)),
        message: delivery.message,
        ...(delivery.model ? { model: structuredClone(delivery.model) } : {}),
      };
    });
  }

  async finishInboundDelivery(
    deliveryId: string,
    input:
      | { status: "completed"; runId: string }
      | { status: "failed"; error: string; runId?: string },
  ): Promise<InboundDelivery> {
    this.host.assertInitialized();
    return this.host.stateQueue.run(async () => {
      const delivery = this.host.mutableInboundDelivery(deliveryId);
      if (delivery.status === "completed" || delivery.status === "failed") {
        return structuredClone(stripDeliverySecrets(delivery));
      }
      if (delivery.status !== "running") {
        throw new Error("Inbound delivery is not running");
      }
      if (input.runId) {
        const run = this.host.state.runs.find(
          (candidate) =>
            candidate.id === input.runId &&
            candidate.threadId === delivery.threadId,
        );
        if (!run) throw new Error("Inbound run does not belong to its thread");
        delivery.runId = input.runId;
      }
      delivery.status = input.status;
      if (input.status === "failed") {
        delivery.error = input.error.slice(0, 500);
      } else {
        delete delivery.error;
      }
      delete delivery.nextAttemptAt;
      delivery.finishedAt = nowIso();
      delivery.revision += 1;
      await this.host.persistState();
      return structuredClone(stripDeliverySecrets(delivery));
    });
  }

  async scheduleInboundDeliveryRetry(
    deliveryId: string,
    error: string,
    delayMs: number,
    now = new Date(),
  ): Promise<InboundDelivery> {
    this.host.assertInitialized();
    if (
      !Number.isInteger(delayMs) ||
      delayMs < 1 ||
      delayMs > MAX_INBOUND_RETRY_DELAY_MS
    ) {
      throw new Error("Inbound retry delay is invalid");
    }
    const timestamp = now.toISOString();
    return this.host.stateQueue.run(async () => {
      const delivery = this.host.mutableInboundDelivery(deliveryId);
      if (delivery.status !== "running") {
        return structuredClone(stripDeliverySecrets(delivery));
      }
      delivery.error = error.slice(0, 500);
      if (delivery.attemptCount >= delivery.maxAttempts) {
        delivery.status = "failed";
        delivery.finishedAt = timestamp;
        delete delivery.nextAttemptAt;
      } else {
        delivery.status = "retrying";
        delivery.nextAttemptAt = new Date(
          now.getTime() + delayMs,
        ).toISOString();
        delete delivery.finishedAt;
      }
      delivery.revision += 1;
      await this.host.persistState();
      return structuredClone(stripDeliverySecrets(delivery));
    });
  }

  async retryInboundDelivery(
    channelId: string,
    deliveryId: string,
    now = new Date(),
  ): Promise<InboundDelivery> {
    this.host.assertInitialized();
    const timestamp = now.toISOString();
    return this.host.stateQueue.run(async () => {
      this.host.mutableInboundChannel(channelId);
      const delivery = this.host.mutableInboundDelivery(deliveryId);
      if (delivery.channelId !== channelId) {
        throw new Error("Inbound delivery not found in channel");
      }
      if (delivery.status !== "failed") {
        throw new Error("Only failed inbound deliveries can be retried");
      }
      if (delivery.attemptCount >= delivery.maxAttempts) {
        throw new Error("Inbound delivery retry limit is exhausted");
      }
      const run = delivery.runId
        ? this.host.state.runs.find(
            (candidate) => candidate.id === delivery.runId,
          )
        : undefined;
      if (run?.status === "queued" || run?.status === "running") {
        throw new Error("Inbound delivery run is still active");
      }
      delivery.status = "retrying";
      delivery.nextAttemptAt = timestamp;
      delete delivery.finishedAt;
      delivery.revision += 1;
      await this.host.persistState();
      return structuredClone(stripDeliverySecrets(delivery));
    });
  }

  listRunnableInboundDeliveryIds(now = new Date()): string[] {
    this.host.assertInitialized();
    const timestamp = now.getTime();
    return this.host.state.inboundDeliveries
      .filter(
        (delivery) =>
          delivery.status === "accepted" ||
          (delivery.status === "retrying" &&
            (!delivery.nextAttemptAt ||
              Date.parse(delivery.nextAttemptAt) <= timestamp)),
      )
      .map((delivery) => delivery.id);
  }
}
