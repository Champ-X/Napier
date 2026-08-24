import {
  type CreateReceiptTrustAnchorDirectorySubscriptionRequest,
  type ReceiptTrustAnchorDirectoryDiscovery,
  type ReceiptTrustAnchorDirectorySubscription,
  type ReceiptTrustAnchorDirectorySubscriptionRefreshResult,
  type UpdateReceiptTrustAnchorDirectorySubscriptionRequest
} from "@napier/contracts";
import { randomBytes,timingSafeEqual } from "node:crypto";
import {
  createReceiptTrustAnchorDirectorySubscription,
  MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS,
  settleReceiptTrustAnchorDirectorySubscriptionRefresh,
  stripReceiptTrustAnchorDirectorySubscriptionSecrets,
  updateReceiptTrustAnchorDirectorySubscriptionStatus,
  type ReceiptTrustAnchorDirectorySubscriptionClaim
} from "./receipt-trust-directory-subscriptions.js";
import type { StoreRepositoryHost } from "./store-repository-host.js";
import {
  normalizeLeaseOwner
} from "./run-lease-renewal.js";
import {
  storeSha256 as sha256
} from "./store-hashing.js";

export interface DueReceiptTrustAnchorDirectorySubscriptionClaims {
  claims: ReceiptTrustAnchorDirectorySubscriptionClaim[];
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

export class ReceiptTrustDirectorySubscriptionRepository {
  constructor(private readonly host: StoreRepositoryHost) {}

  async createReceiptTrustAnchorDirectorySubscription(
      request: CreateReceiptTrustAnchorDirectorySubscriptionRequest,
      discovery: ReceiptTrustAnchorDirectoryDiscovery,
    ): Promise<ReceiptTrustAnchorDirectorySubscription> {
      this.host.assertInitialized();
      this.host.getThread(request.threadId);
      const subscription = createReceiptTrustAnchorDirectorySubscription(
        request,
        discovery,
      );
      return this.host.stateQueue.run(async () => {
        if (
          this.host.state.receiptTrustAnchorDirectorySubscriptions.length >=
          MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS
        ) {
          throw new Error(
            `Workspace exceeds ${MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS} receipt trust anchor directory subscriptions`,
          );
        }
        if (
          this.host.state.receiptTrustAnchorDirectorySubscriptions.some(
            (candidate) =>
              candidate.sourceUrlSha256 === subscription.sourceUrlSha256,
          )
        ) {
          throw new Error(
            "Receipt trust anchor directory subscription source already exists",
          );
        }
        this.host.state.receiptTrustAnchorDirectorySubscriptions.push(subscription);
        await this.host.persistState();
        return stripReceiptTrustAnchorDirectorySubscriptionSecrets(subscription);
      });
    }

  async updateReceiptTrustAnchorDirectorySubscription(
      subscriptionId: string,
      request: UpdateReceiptTrustAnchorDirectorySubscriptionRequest,
    ): Promise<ReceiptTrustAnchorDirectorySubscription> {
      this.host.assertInitialized();
      this.host.getThread(request.threadId);
      return this.host.stateQueue.run(async () => {
        const index =
          this.host.state.receiptTrustAnchorDirectorySubscriptions.findIndex(
            (candidate) => candidate.id === subscriptionId,
          );
        const current =
          this.host.state.receiptTrustAnchorDirectorySubscriptions[index];
        if (!current) {
          throw new Error(
            `Receipt trust anchor directory subscription not found: ${subscriptionId}`,
          );
        }
        if (current.revision !== request.expectedRevision) {
          throw new Error(
            "Receipt trust anchor directory subscription revision changed",
          );
        }
        if (current.claim && Date.parse(current.claim.expiresAt) > Date.now()) {
          throw new Error(
            "Receipt trust anchor directory subscription refresh is in progress",
          );
        }
        const hadExpiredClaim = current.claim !== undefined;
        delete current.claim;
        delete current.claimTokenSha256;
        const updated = updateReceiptTrustAnchorDirectorySubscriptionStatus(
          current,
          request.status,
        );
        this.host.state.receiptTrustAnchorDirectorySubscriptions[index] = updated;
        if (updated.revision !== current.revision || hadExpiredClaim) {
          await this.host.persistState();
        }
        return stripReceiptTrustAnchorDirectorySubscriptionSecrets(updated);
      });
    }

  async claimReceiptTrustAnchorDirectorySubscription(
      subscriptionId: string,
      expectedRevision: number,
      ownerId: string,
      options: { now?: Date; leaseMs?: number } = {},
    ): Promise<ReceiptTrustAnchorDirectorySubscriptionClaim> {
      this.host.assertInitialized();
      const owner = normalizeLeaseOwner(ownerId);
      const now = options.now ?? new Date();
      if (!Number.isFinite(now.getTime())) {
        throw new Error("Receipt trust anchor directory claim time is invalid");
      }
      const leaseMs = validateLeaseTtl(options.leaseMs ?? 30_000);
      return this.host.stateQueue.run(async () => {
        const subscription =
          this.host.state.receiptTrustAnchorDirectorySubscriptions.find(
            (candidate) => candidate.id === subscriptionId,
          );
        if (!subscription) {
          throw new Error(
            `Receipt trust anchor directory subscription not found: ${subscriptionId}`,
          );
        }
        if (subscription.revision !== expectedRevision) {
          throw new Error(
            "Receipt trust anchor directory subscription revision changed",
          );
        }
        if (
          subscription.claim &&
          Date.parse(subscription.claim.expiresAt) > now.getTime()
        ) {
          throw new Error(
            "Receipt trust anchor directory subscription refresh is in progress",
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
            stripReceiptTrustAnchorDirectorySubscriptionSecrets(subscription),
          sourceUrl: subscription.sourceUrl,
          token,
        };
      });
    }

  async claimDueReceiptTrustAnchorDirectorySubscriptions(
      ownerId: string,
      options: {
        now?: Date;
        leaseMs?: number;
        limit?: number;
      } = {},
    ): Promise<DueReceiptTrustAnchorDirectorySubscriptionClaims> {
      this.host.assertInitialized();
      const owner = normalizeLeaseOwner(ownerId);
      const now = options.now ?? new Date();
      if (!Number.isFinite(now.getTime())) {
        throw new Error("Receipt trust anchor directory claim time is invalid");
      }
      const leaseMs = validateLeaseTtl(options.leaseMs ?? 30_000);
      const limit = Math.min(Math.max(options.limit ?? 5, 1), 20);
      return this.host.stateQueue.run(async () => {
        const claims: ReceiptTrustAnchorDirectorySubscriptionClaim[] = [];
        const due = this.host.state.receiptTrustAnchorDirectorySubscriptions
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
              stripReceiptTrustAnchorDirectorySubscriptionSecrets(subscription),
            sourceUrl: subscription.sourceUrl,
            token,
          });
        }
        if (claims.length > 0) await this.host.persistState();
        return { claims };
      });
    }

  async settleReceiptTrustAnchorDirectorySubscriptionClaim(
      subscriptionId: string,
      token: string,
      outcome:
        | { discovery: ReceiptTrustAnchorDirectoryDiscovery }
        | { failureSha256: string },
    ): Promise<ReceiptTrustAnchorDirectorySubscriptionRefreshResult> {
      this.host.assertInitialized();
      return this.host.stateQueue.run(async () => {
        const index =
          this.host.state.receiptTrustAnchorDirectorySubscriptions.findIndex(
            (candidate) => candidate.id === subscriptionId,
          );
        const current =
          this.host.state.receiptTrustAnchorDirectorySubscriptions[index];
        if (!current) {
          throw new Error(
            `Receipt trust anchor directory subscription not found: ${subscriptionId}`,
          );
        }
        assertLeaseToken(current.claimTokenSha256, token);
        if (!current.claim) {
          throw new Error(
            "Receipt trust anchor directory subscription claim is not active",
          );
        }
        if (Date.parse(current.claim.expiresAt) <= Date.now()) {
          throw new Error(
            "Receipt trust anchor directory subscription claim expired",
          );
        }
        const settled = settleReceiptTrustAnchorDirectorySubscriptionRefresh(
          current,
          outcome,
        );
        this.host.state.receiptTrustAnchorDirectorySubscriptions[index] =
          settled.persisted;
        await this.host.persistState();
        return settled.result;
      });
    }
}
