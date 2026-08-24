import {
  type CreatedInboundChannel,
  type CreateInboundChannelRequest,
  type InboundChannel,
  type InboundDelivery,
  type InboundMessageRequest,
  type InboundReceipt,
  type InboundRetryPolicy,
  type UpdateInboundSignaturePolicyRequest,
} from "@napier/contracts";
import { createId, nowIso } from "./ids.js";
import { storeSha256 as sha256 } from "./store-hashing.js";
import type { StoreRepositoryHost } from "./store-repository-host.js";
import {
  createLeaseToken,
  assertHashedToken,
  normalizeChannelName,
  normalizeInboundChannelAdapter,
  normalizeInboundChannelPolicy,
  deriveInboundChannelPolicyTemplate,
  normalizeInboundRetryPolicy,
  normalizeInboundSignaturePolicy,
  normalizeIdempotencyKey,
  normalizeInboundMessage,
  normalizeOptionalSha256,
  normalizeInboundModel,
} from "./inbound-channel-policy.js";

interface PersistedInboundChannel extends InboundChannel {
  tokenSha256: string;
}

interface PersistedInboundDelivery extends InboundDelivery {
  idempotencySha256: string;
  message: string;
  model?: InboundMessageRequest["model"];
}

function stripChannelSecrets(channel: PersistedInboundChannel): InboundChannel {
  const { tokenSha256: _tokenSha256, ...output } = structuredClone(channel);
  return output;
}

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

export class InboundChannelRepository {
  constructor(private readonly host: StoreRepositoryHost) {}

  listInboundChannels(): InboundChannel[] {
    this.host.assertInitialized();
    return structuredClone(
      this.host.state.channels
        .map(stripChannelSecrets)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    );
  }

  getInboundChannel(channelId: string): InboundChannel {
    this.host.assertInitialized();
    const channel = this.host.state.channels.find(
      (candidate) => candidate.id === channelId,
    );
    if (!channel) throw new Error(`Inbound channel not found: ${channelId}`);
    return structuredClone(stripChannelSecrets(channel));
  }

  async createInboundChannel(
    request: CreateInboundChannelRequest,
  ): Promise<CreatedInboundChannel> {
    this.host.assertInitialized();
    this.host.getThread(request.threadId);
    const policy = normalizeInboundChannelPolicy(request);
    const retryPolicy = normalizeInboundRetryPolicy(policy.retryPolicy);
    const signaturePolicy = normalizeInboundSignaturePolicy(
      policy.signaturePolicy,
    );
    const token = createLeaseToken();
    const tokenSha256 = sha256(token);
    const timestamp = nowIso();
    const channel: PersistedInboundChannel = {
      id: createId("channel"),
      type: "webhook",
      adapter: normalizeInboundChannelAdapter(request.adapter),
      name: normalizeChannelName(request.name),
      threadId: request.threadId,
      status: "active",
      tokenFingerprint: tokenSha256.slice(0, 12),
      tokenSha256,
      policyTemplate: deriveInboundChannelPolicyTemplate(
        retryPolicy,
        signaturePolicy,
      ),
      signaturePolicy,
      retryPolicy,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    return this.host.stateQueue.run(async () => {
      this.host.state.channels.push(channel);
      await this.host.persistState();
      return {
        channel: structuredClone(stripChannelSecrets(channel)),
        token,
      };
    });
  }

  async setInboundChannelStatus(
    channelId: string,
    status: InboundChannel["status"],
  ): Promise<InboundChannel> {
    this.host.assertInitialized();
    return this.host.stateQueue.run(async () => {
      const channel = this.host.mutableInboundChannel(channelId);
      if (status !== "active" && status !== "disabled") {
        throw new Error("Inbound channel status is invalid");
      }
      if (channel.status !== status) {
        channel.status = status;
        channel.revision += 1;
        channel.updatedAt = nowIso();
        await this.host.persistState();
      }
      return structuredClone(stripChannelSecrets(channel));
    });
  }

  async updateInboundRetryPolicy(
    channelId: string,
    retryPolicy: InboundRetryPolicy,
  ): Promise<InboundChannel> {
    this.host.assertInitialized();
    const normalized = normalizeInboundRetryPolicy(retryPolicy, false);
    return this.host.stateQueue.run(async () => {
      const channel = this.host.mutableInboundChannel(channelId);
      if (
        channel.retryPolicy.maxAttempts !== normalized.maxAttempts ||
        channel.retryPolicy.baseDelayMs !== normalized.baseDelayMs
      ) {
        channel.retryPolicy = normalized;
        channel.policyTemplate = deriveInboundChannelPolicyTemplate(
          channel.retryPolicy,
          channel.signaturePolicy,
        );
        channel.revision += 1;
        channel.updatedAt = nowIso();
        await this.host.persistState();
      }
      return structuredClone(stripChannelSecrets(channel));
    });
  }

  async updateInboundSignaturePolicy(
    channelId: string,
    signaturePolicy: UpdateInboundSignaturePolicyRequest["signaturePolicy"],
  ): Promise<InboundChannel> {
    this.host.assertInitialized();
    const normalized = normalizeInboundSignaturePolicy(signaturePolicy);
    return this.host.stateQueue.run(async () => {
      const channel = this.host.mutableInboundChannel(channelId);
      if (
        channel.signaturePolicy.required !== normalized.required ||
        channel.signaturePolicy.toleranceSeconds !== normalized.toleranceSeconds
      ) {
        channel.signaturePolicy = normalized;
        channel.policyTemplate = deriveInboundChannelPolicyTemplate(
          channel.retryPolicy,
          channel.signaturePolicy,
        );
        channel.revision += 1;
        channel.updatedAt = nowIso();
        await this.host.persistState();
      }
      return structuredClone(stripChannelSecrets(channel));
    });
  }

  async rotateInboundChannelToken(
    channelId: string,
  ): Promise<CreatedInboundChannel> {
    this.host.assertInitialized();
    return this.host.stateQueue.run(async () => {
      const channel = this.host.mutableInboundChannel(channelId);
      const token = createLeaseToken();
      const tokenSha256 = sha256(token);
      channel.tokenSha256 = tokenSha256;
      channel.tokenFingerprint = tokenSha256.slice(0, 12);
      channel.revision += 1;
      channel.updatedAt = nowIso();
      await this.host.persistState();
      return {
        channel: structuredClone(stripChannelSecrets(channel)),
        token,
      };
    });
  }

  async acceptInboundDelivery(
    channelId: string,
    token: string,
    request: InboundMessageRequest,
  ): Promise<InboundReceipt> {
    this.host.assertInitialized();
    const idempotencyKey = normalizeIdempotencyKey(request.idempotencyKey);
    const message = normalizeInboundMessage(request.message);
    const bodySha256 = normalizeOptionalSha256(
      request.bodySha256,
      "Inbound body SHA-256",
    );
    const adapterCatalogSha256 = normalizeOptionalSha256(
      request.adapterCatalogSha256,
      "Inbound adapter catalog SHA-256",
    );
    const idempotencySha256 = sha256(`${channelId}\0${idempotencyKey}`);
    return this.host.stateQueue.run(async () => {
      const channel = this.host.mutableInboundChannel(channelId);
      assertHashedToken(channel.tokenSha256, token, "Inbound channel token");
      if (channel.status !== "active") {
        throw new Error("Inbound channel is disabled");
      }
      const existing = this.host.state.inboundDeliveries.find(
        (candidate) =>
          candidate.channelId === channelId &&
          candidate.idempotencySha256 === idempotencySha256,
      );
      if (existing) {
        return {
          delivery: structuredClone(stripDeliverySecrets(existing)),
          duplicate: true,
        };
      }
      const timestamp = nowIso();
      const deliveryId = createId("delivery");
      const delivery: PersistedInboundDelivery = {
        id: deliveryId,
        channelId,
        threadId: channel.threadId,
        idempotencyFingerprint: idempotencySha256.slice(0, 12),
        idempotencySha256,
        ...(bodySha256 ? { bodySha256 } : {}),
        ...(adapterCatalogSha256 ? { adapterCatalogSha256 } : {}),
        status: "accepted",
        triggerId: `channel:${channelId}:${deliveryId}`,
        attemptCount: 0,
        maxAttempts: channel.retryPolicy.maxAttempts,
        retryBaseMs: channel.retryPolicy.baseDelayMs,
        message,
        ...(request.model
          ? { model: normalizeInboundModel(request.model) }
          : {}),
        createdAt: timestamp,
        revision: 1,
      };
      this.host.state.inboundDeliveries.push(delivery);
      await this.host.persistState();
      return {
        delivery: structuredClone(stripDeliverySecrets(delivery)),
        duplicate: false,
      };
    });
  }
}
