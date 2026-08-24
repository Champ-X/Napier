import {
  type CreateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRequest,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscovery,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRefreshResult,
  type UpdateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRequest
} from "@napier/contracts";
import { randomBytes,timingSafeEqual } from "node:crypto";
import {
  createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription,
  MAX_RECEIPT_TRUST_ROTATION_PROPOSAL_SUBSCRIPTIONS,
  settleReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRefresh,
  stripReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionSecrets,
  updateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionStatus,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionClaim
} from "./receipt-trust-directory-subscriptions.js";
import type { StoreRepositoryHost } from "./store-repository-host.js";
import {
  normalizeLeaseOwner
} from "./run-lease-renewal.js";
import {
  storeSha256 as sha256
} from "./store-hashing.js";

export interface DueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionClaims {
  claims: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionClaim[];
}

function createLeaseToken(): string {
  return randomBytes(32).toString("base64url");
}

function assertLeaseToken(
  expectedSha256: string | undefined,
  token: string | undefined,
): void {
  assertHashedToken(expectedSha256, token, "Lease token");
}

function assertHashedToken(
  expectedSha256: string | undefined,
  token: string | undefined,
  label: string,
): void {
  if (!expectedSha256 || !token) throw new Error(`${label} is required`);
  const expected = Buffer.from(expectedSha256, "hex");
  const actual = Buffer.from(sha256(token), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error(`${label} is invalid`);
  }
}

function validateLeaseTtl(value: number): number {
  if (!Number.isInteger(value) || value < 5_000 || value > 10 * 60_000) {
    throw new Error("Lease TTL must be an integer from 5000 to 600000 ms");
  }
  return value;
}

export class ReceiptTrustRotationSubscriptionRepository {
  constructor(private readonly host: StoreRepositoryHost) {}

  listReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions(): ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription[] {
      this.host.assertInitialized();
      return this.host.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions
        .map(
          stripReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionSecrets,
        )
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    }

  getReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(
      subscriptionId: string,
    ): ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription {
      this.host.assertInitialized();
      const subscription =
        this.host.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions.find(
          (candidate) => candidate.id === subscriptionId,
        );
      if (!subscription) {
        throw new Error(
          `Receipt trust anchor directory quorum activation selection rotation proposal subscription not found: ${subscriptionId}`,
        );
      }
      return stripReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionSecrets(
        subscription,
      );
    }

  getReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRefreshSource(
      subscriptionId: string,
      threadId: string,
      expectedRevision: number,
    ): {
      subscription: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription;
      sourceUrl: string;
    } {
      this.host.assertInitialized();
      this.host.getThread(threadId);
      const subscription =
        this.host.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions.find(
          (candidate) => candidate.id === subscriptionId,
        );
      if (!subscription) {
        throw new Error(
          `Receipt trust anchor directory quorum activation selection rotation proposal subscription not found: ${subscriptionId}`,
        );
      }
      if (subscription.auditThreadId !== threadId) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal subscription audit thread changed",
        );
      }
      if (subscription.revision !== expectedRevision) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal subscription revision changed",
        );
      }
      return {
        subscription:
          stripReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionSecrets(
            subscription,
          ),
        sourceUrl: subscription.sourceUrl,
      };
    }

  async createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(
      request: CreateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRequest,
      discovery: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscovery,
    ): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription> {
      this.host.assertInitialized();
      this.host.getThread(request.threadId);
      const subscription =
        createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(
          request,
          discovery,
        );
      return this.host.stateQueue.run(async () => {
        if (
          this.host.state
            .receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions
            .length >= MAX_RECEIPT_TRUST_ROTATION_PROPOSAL_SUBSCRIPTIONS
        ) {
          throw new Error(
            `Workspace exceeds ${MAX_RECEIPT_TRUST_ROTATION_PROPOSAL_SUBSCRIPTIONS} receipt trust anchor directory quorum activation selection rotation proposal subscriptions`,
          );
        }
        if (
          this.host.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions.some(
            (candidate) =>
              candidate.sourceUrlSha256 === subscription.sourceUrlSha256,
          )
        ) {
          throw new Error(
            "Receipt trust anchor directory quorum activation selection rotation proposal subscription source already exists",
          );
        }
        this.host.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions.push(
          subscription,
        );
        await this.host.persistState();
        return stripReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionSecrets(
          subscription,
        );
      });
    }

  async updateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(
      subscriptionId: string,
      request: UpdateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRequest,
    ): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription> {
      this.host.assertInitialized();
      this.host.getThread(request.threadId);
      return this.host.stateQueue.run(async () => {
        const index =
          this.host.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions.findIndex(
            (candidate) => candidate.id === subscriptionId,
          );
        const current =
          this.host.state
            .receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions[
            index
          ];
        if (!current) {
          throw new Error(
            `Receipt trust anchor directory quorum activation selection rotation proposal subscription not found: ${subscriptionId}`,
          );
        }
        if (current.revision !== request.expectedRevision) {
          throw new Error(
            "Receipt trust anchor directory quorum activation selection rotation proposal subscription revision changed",
          );
        }
        if (current.claim && Date.parse(current.claim.expiresAt) > Date.now()) {
          throw new Error(
            "Receipt trust anchor directory quorum activation selection rotation proposal subscription refresh is in progress",
          );
        }
        const hadExpiredClaim = current.claim !== undefined;
        delete current.claim;
        delete current.claimTokenSha256;
        const updated =
          updateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionStatus(
            current,
            request.status,
          );
        this.host.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions[
          index
        ] = updated;
        if (updated.revision !== current.revision || hadExpiredClaim) {
          await this.host.persistState();
        }
        return stripReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionSecrets(
          updated,
        );
      });
    }

  async refreshReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(
      subscriptionId: string,
      threadId: string,
      expectedRevision: number,
      outcome:
        | {
            discovery: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscovery;
          }
        | { failureSha256: string },
    ): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRefreshResult> {
      this.host.assertInitialized();
      this.host.getThread(threadId);
      return this.host.stateQueue.run(async () => {
        const index =
          this.host.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions.findIndex(
            (candidate) => candidate.id === subscriptionId,
          );
        const current =
          this.host.state
            .receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions[
            index
          ];
        if (!current) {
          throw new Error(
            `Receipt trust anchor directory quorum activation selection rotation proposal subscription not found: ${subscriptionId}`,
          );
        }
        if (current.auditThreadId !== threadId) {
          throw new Error(
            "Receipt trust anchor directory quorum activation selection rotation proposal subscription audit thread changed",
          );
        }
        if (current.revision !== expectedRevision) {
          throw new Error(
            "Receipt trust anchor directory quorum activation selection rotation proposal subscription revision changed",
          );
        }
        if (current.claim && Date.parse(current.claim.expiresAt) > Date.now()) {
          throw new Error(
            "Receipt trust anchor directory quorum activation selection rotation proposal subscription refresh is in progress",
          );
        }
        delete current.claim;
        delete current.claimTokenSha256;
        const settled =
          settleReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRefresh(
            current,
            outcome,
          );
        this.host.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions[
          index
        ] = settled.persisted;
        await this.host.persistState();
        return settled.result;
      });
    }

  async claimReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(
      subscriptionId: string,
      expectedRevision: number,
      ownerId: string,
      options: { now?: Date; leaseMs?: number } = {},
    ): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionClaim> {
      this.host.assertInitialized();
      const owner = normalizeLeaseOwner(ownerId);
      const now = options.now ?? new Date();
      if (!Number.isFinite(now.getTime())) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal claim time is invalid",
        );
      }
      const leaseMs = validateLeaseTtl(options.leaseMs ?? 30_000);
      return this.host.stateQueue.run(async () => {
        const subscription =
          this.host.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions.find(
            (candidate) => candidate.id === subscriptionId,
          );
        if (!subscription) {
          throw new Error(
            `Receipt trust anchor directory quorum activation selection rotation proposal subscription not found: ${subscriptionId}`,
          );
        }
        if (subscription.revision !== expectedRevision) {
          throw new Error(
            "Receipt trust anchor directory quorum activation selection rotation proposal subscription revision changed",
          );
        }
        if (
          subscription.claim &&
          Date.parse(subscription.claim.expiresAt) > now.getTime()
        ) {
          throw new Error(
            "Receipt trust anchor directory quorum activation selection rotation proposal subscription refresh is in progress",
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
            stripReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionSecrets(
              subscription,
            ),
          sourceUrl: subscription.sourceUrl,
          token,
        };
      });
    }

  async claimDueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions(
      ownerId: string,
      options: {
        now?: Date;
        leaseMs?: number;
        limit?: number;
      } = {},
    ): Promise<DueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionClaims> {
      this.host.assertInitialized();
      const owner = normalizeLeaseOwner(ownerId);
      const now = options.now ?? new Date();
      if (!Number.isFinite(now.getTime())) {
        throw new Error(
          "Receipt trust anchor directory quorum activation selection rotation proposal claim time is invalid",
        );
      }
      const leaseMs = validateLeaseTtl(options.leaseMs ?? 30_000);
      const limit = Math.min(Math.max(options.limit ?? 5, 1), 20);
      return this.host.stateQueue.run(async () => {
        const claims: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionClaim[] =
          [];
        const due =
          this.host.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions
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
              stripReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionSecrets(
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

  async settleReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionClaim(
      subscriptionId: string,
      token: string,
      outcome:
        | {
            discovery: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscovery;
          }
        | { failureSha256: string },
    ): Promise<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRefreshResult> {
      this.host.assertInitialized();
      return this.host.stateQueue.run(async () => {
        const index =
          this.host.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions.findIndex(
            (candidate) => candidate.id === subscriptionId,
          );
        const current =
          this.host.state
            .receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions[
            index
          ];
        if (!current) {
          throw new Error(
            `Receipt trust anchor directory quorum activation selection rotation proposal subscription not found: ${subscriptionId}`,
          );
        }
        assertLeaseToken(current.claimTokenSha256, token);
        if (!current.claim) {
          throw new Error(
            "Receipt trust anchor directory quorum activation selection rotation proposal subscription claim is not active",
          );
        }
        if (Date.parse(current.claim.expiresAt) <= Date.now()) {
          throw new Error(
            "Receipt trust anchor directory quorum activation selection rotation proposal subscription claim expired",
          );
        }
        const settled =
          settleReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRefresh(
            current,
            outcome,
          );
        this.host.state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions[
          index
        ] = settled.persisted;
        await this.host.persistState();
        return settled.result;
      });
    }
}
