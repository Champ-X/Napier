import {
  type CreateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRefreshResult,
  type UpdateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest,
} from "@napier/contracts";
import {
  createReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription,
  MAX_RECEIPT_TRUST_CHECKPOINT_SUBSCRIPTIONS,
  settleReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRefresh,
  stripReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionSecrets,
  updateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionStatus,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionClaim,
} from "./receipt-trust-directory-subscriptions.js";
import type { StoreRepositoryHost } from "./store-repository-host.js";
import {
  assertRepositoryLeaseToken as assertLeaseToken,
  createRepositoryLeaseToken as createLeaseToken,
  validateRepositoryLeaseTtl as validateLeaseTtl,
} from "./repository-lease.js";
import { normalizeLeaseOwner } from "./run-lease-renewal.js";
import { storeSha256 as sha256 } from "./store-hashing.js";

export interface DueReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionClaims {
  claims: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionClaim[];
}

export class ReceiptTrustCheckpointSubscriptionRepository {
  constructor(private readonly host: StoreRepositoryHost) {}

  listReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions(): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription[] {
    this.host.assertInitialized();
    return this.host.state.receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions
      .map(
        stripReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionSecrets,
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription(
    subscriptionId: string,
  ): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription {
    this.host.assertInitialized();
    const subscription =
      this.host.state.receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions.find(
        (candidate) => candidate.id === subscriptionId,
      );
    if (!subscription) {
      throw new Error(
        `Receipt trust anchor directory quorum activation selection checkpoint subscription not found: ${subscriptionId}`,
      );
    }
    return stripReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionSecrets(
      subscription,
    );
  }

  async createReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription(
    request: CreateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest,
    discovery: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery,
  ): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription> {
    this.host.assertInitialized();
    this.host.getThread(request.threadId);
    const subscription =
      createReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription(
        request,
        discovery,
      );
    return this.host.stateQueue.run(async () => {
      if (
        this.host.state
          .receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions
          .length >= MAX_RECEIPT_TRUST_CHECKPOINT_SUBSCRIPTIONS
      ) {
        throw new Error(
          `Workspace exceeds ${MAX_RECEIPT_TRUST_CHECKPOINT_SUBSCRIPTIONS} receipt trust anchor directory quorum activation selection checkpoint subscriptions`,
        );
      }
      if (
        this.host.state.receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions.some(
          (candidate) =>
            candidate.sourceUrlSha256 === subscription.sourceUrlSha256,
        )
      ) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection checkpoint subscription source already exists",
        );
      }
      this.host.state.receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions.push(
        subscription,
      );
      await this.host.persistState();
      return stripReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionSecrets(
        subscription,
      );
    });
  }

  async updateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription(
    subscriptionId: string,
    request: UpdateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest,
  ): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription> {
    this.host.assertInitialized();
    this.host.getThread(request.threadId);
    return this.host.stateQueue.run(async () => {
      const index =
        this.host.state.receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions.findIndex(
          (candidate) => candidate.id === subscriptionId,
        );
      const current =
        this.host.state
          .receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions[
          index
        ];
      if (!current) {
        throw new Error(
          `Receipt trust anchor directory quorum activation selection checkpoint subscription not found: ${subscriptionId}`,
        );
      }
      if (current.revision !== request.expectedRevision) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection checkpoint subscription revision changed",
        );
      }
      if (current.claim && Date.parse(current.claim.expiresAt) > Date.now()) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection checkpoint subscription refresh is in progress",
        );
      }
      const hadExpiredClaim = current.claim !== undefined;
      delete current.claim;
      delete current.claimTokenSha256;
      const updated =
        updateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionStatus(
          current,
          request.status,
        );
      this.host.state.receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions[
        index
      ] = updated;
      if (updated.revision !== current.revision || hadExpiredClaim) {
        await this.host.persistState();
      }
      return stripReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionSecrets(
        updated,
      );
    });
  }

  async claimReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription(
    subscriptionId: string,
    expectedRevision: number,
    ownerId: string,
    options: { now?: Date; leaseMs?: number } = {},
  ): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionClaim> {
    this.host.assertInitialized();
    const owner = normalizeLeaseOwner(ownerId);
    const now = options.now ?? new Date();
    if (!Number.isFinite(now.getTime())) {
      throw new Error(
        "Receipt trust anchor directory quorum activation selection checkpoint claim time is invalid",
      );
    }
    const leaseMs = validateLeaseTtl(options.leaseMs ?? 30_000);
    return this.host.stateQueue.run(async () => {
      const subscription =
        this.host.state.receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions.find(
          (candidate) => candidate.id === subscriptionId,
        );
      if (!subscription) {
        throw new Error(
          `Receipt trust anchor directory quorum activation selection checkpoint subscription not found: ${subscriptionId}`,
        );
      }
      if (subscription.revision !== expectedRevision) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection checkpoint subscription revision changed",
        );
      }
      if (
        subscription.claim &&
        Date.parse(subscription.claim.expiresAt) > now.getTime()
      ) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection checkpoint subscription refresh is in progress",
        );
      }
      const token = createLeaseToken();
      subscription.claim = {
        ownerId: owner,
        acquiredAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + leaseMs).toISOString(),
      };
      subscription.claimTokenSha256 = sha256(token);
      await this.host.persistState();
      return {
        subscription:
          stripReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionSecrets(
            subscription,
          ),
        sourceUrl: subscription.sourceUrl,
        token,
      };
    });
  }

  async claimDueReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions(
    ownerId: string,
    options: {
      now?: Date;
      leaseMs?: number;
      limit?: number;
    } = {},
  ): Promise<DueReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionClaims> {
    this.host.assertInitialized();
    const owner = normalizeLeaseOwner(ownerId);
    const now = options.now ?? new Date();
    if (!Number.isFinite(now.getTime())) {
      throw new Error(
        "Receipt trust anchor directory quorum activation selection checkpoint claim time is invalid",
      );
    }
    const leaseMs = validateLeaseTtl(options.leaseMs ?? 30_000);
    const limit = Math.min(Math.max(options.limit ?? 5, 1), 20);
    return this.host.stateQueue.run(async () => {
      const claims: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionClaim[] =
        [];
      const due =
        this.host.state.receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions
          .filter(
            (subscription) =>
              subscription.status === "active" &&
              Date.parse(subscription.nextRefreshAt) <= now.getTime(),
          )
          .sort((left, right) =>
            left.nextRefreshAt.localeCompare(right.nextRefreshAt),
          );
      for (const subscription of due) {
        if (claims.length >= limit) break;
        if (
          subscription.claim &&
          Date.parse(subscription.claim.expiresAt) > now.getTime()
        ) {
          continue;
        }
        const token = createLeaseToken();
        subscription.claim = {
          ownerId: owner,
          acquiredAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + leaseMs).toISOString(),
        };
        subscription.claimTokenSha256 = sha256(token);
        claims.push({
          subscription:
            stripReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionSecrets(
              subscription,
            ),
          sourceUrl: subscription.sourceUrl,
          token,
        });
      }
      if (claims.length > 0) await this.host.persistState();
      return { claims };
    });
  }

  async settleReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionClaim(
    subscriptionId: string,
    token: string,
    outcome:
      | {
          discovery: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery;
        }
      | { failureSha256: string },
  ): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRefreshResult> {
    this.host.assertInitialized();
    return this.host.stateQueue.run(async () => {
      const index =
        this.host.state.receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions.findIndex(
          (candidate) => candidate.id === subscriptionId,
        );
      const current =
        this.host.state
          .receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions[
          index
        ];
      if (!current) {
        throw new Error(
          `Receipt trust anchor directory quorum activation selection checkpoint subscription not found: ${subscriptionId}`,
        );
      }
      assertLeaseToken(current.claimTokenSha256, token);
      if (!current.claim) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection checkpoint subscription claim is not active",
        );
      }
      if (Date.parse(current.claim.expiresAt) <= Date.now()) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection checkpoint subscription claim expired",
        );
      }
      const settled =
        settleReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRefresh(
          current,
          outcome,
        );
      this.host.state.receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions[
        index
      ] = settled.persisted;
      await this.host.persistState();
      return settled.result;
    });
  }
}
