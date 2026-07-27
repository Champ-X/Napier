import { createHash } from "node:crypto";

import type {
  JsonValue,
  ReceiptTrustAnchorDirectorySubscriptionRefreshResult,
} from "@napier/contracts";
import { LocalStore, createId } from "@napier/runtime";

import {
  ReceiptTrustAnchorDirectoryDiscoveryError,
  ReceiptTrustAnchorDirectoryDiscoveryService,
} from "./receipt-trust-directory-discovery.js";

const DEFAULT_POLL_INTERVAL_MS = 60_000;
const DEFAULT_CLAIM_LEASE_MS = 30_000;

export interface ReceiptTrustAnchorDirectorySubscriptionServiceOptions {
  pollIntervalMs?: number;
  claimLeaseMs?: number;
  workerId?: string;
}

export class ReceiptTrustAnchorDirectorySubscriptionService {
  private readonly workerId: string;
  private readonly pollIntervalMs: number;
  private readonly claimLeaseMs: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private activeTick: Promise<void> | undefined;

  constructor(
    private readonly store: LocalStore,
    private readonly discovery: ReceiptTrustAnchorDirectoryDiscoveryService,
    options: ReceiptTrustAnchorDirectorySubscriptionServiceOptions = {},
  ) {
    this.workerId = options.workerId ?? createId("trustrefresh");
    this.pollIntervalMs = normalizePositiveInteger(
      options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      "poll interval",
    );
    this.claimLeaseMs = normalizePositiveInteger(
      options.claimLeaseMs ?? DEFAULT_CLAIM_LEASE_MS,
      "claim lease",
    );
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.scheduleTick(), this.pollIntervalMs);
    this.timer.unref();
    this.scheduleTick();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.activeTick;
  }

  async refresh(
    subscriptionId: string,
    threadId: string,
    expectedRevision: number,
  ): Promise<ReceiptTrustAnchorDirectorySubscriptionRefreshResult> {
    this.store.getThread(threadId);
    const subscription =
      this.store.getReceiptTrustAnchorDirectorySubscription(subscriptionId);
    if (subscription.auditThreadId !== threadId) {
      throw new Error(
        "Receipt trust anchor directory subscription audit thread changed",
      );
    }
    const claim = await this.store.claimReceiptTrustAnchorDirectorySubscription(
      subscriptionId,
      expectedRevision,
      this.workerId,
      { leaseMs: this.claimLeaseMs },
    );
    return this.refreshClaim(claim);
  }

  async refreshDue(now = new Date()): Promise<number> {
    const { claims } =
      await this.store.claimDueReceiptTrustAnchorDirectorySubscriptions(
        this.workerId,
        {
          now,
          leaseMs: this.claimLeaseMs,
        },
      );
    await Promise.all(claims.map((claim) => this.refreshClaim(claim)));
    return claims.length;
  }

  private scheduleTick(): void {
    if (this.activeTick) return;
    this.activeTick = this.refreshDue()
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        this.activeTick = undefined;
      });
  }

  private async refreshClaim(
    claim: Awaited<
      ReturnType<LocalStore["claimReceiptTrustAnchorDirectorySubscription"]>
    >,
  ): Promise<ReceiptTrustAnchorDirectorySubscriptionRefreshResult> {
    let result: ReceiptTrustAnchorDirectorySubscriptionRefreshResult;
    try {
      const discovery = await this.discovery.discover({
        sourceUrl: claim.sourceUrl,
        policy: claim.subscription.policy,
      });
      result =
        await this.store.settleReceiptTrustAnchorDirectorySubscriptionClaim(
          claim.subscription.id,
          claim.token,
          { discovery },
        );
    } catch (error) {
      const failureSha256 = hashRefreshFailure(error);
      result =
        await this.store.settleReceiptTrustAnchorDirectorySubscriptionClaim(
          claim.subscription.id,
          claim.token,
          { failureSha256 },
        );
    }
    await this.appendRefreshEvent(result);
    return result;
  }

  private async appendRefreshEvent(
    result: ReceiptTrustAnchorDirectorySubscriptionRefreshResult,
  ): Promise<void> {
    const subscription = result.subscription;
    const payload: Record<string, JsonValue> = {
      subscriptionId: subscription.id,
      subscriptionRevision: subscription.revision,
      subscriptionSha256: subscription.contentSha256,
      sourceUrlSha256: subscription.sourceUrlSha256,
      sourceOriginSha256: subscription.sourceOriginSha256,
      policySha256: subscription.policySha256,
      refreshStatus: result.status,
      refreshResultSha256: result.contentSha256,
      transparencyEntryCount: subscription.transparencyEntryCount,
      transparencyTailSha256: subscription.transparencyTailSha256 ?? "",
      activeDirectorySha256:
        subscription.lastGoodDiscovery?.directory?.contentSha256 ?? "",
      activeAnchorSetSha256:
        subscription.lastGoodDiscovery?.directory?.anchorSetSha256 ?? "",
      ...(result.discovery
        ? { discoverySha256: result.discovery.contentSha256 }
        : {}),
      ...(result.failureSha256 ? { failureSha256: result.failureSha256 } : {}),
    };
    await this.store.appendEvent({
      threadId: subscription.auditThreadId,
      runId: createId("runctl"),
      type: "receipt.trust_directory_subscription.refreshed",
      category: "evaluation",
      visibility: "user",
      payload,
    });
  }
}

function hashRefreshFailure(error: unknown): string {
  const evidence =
    error instanceof ReceiptTrustAnchorDirectoryDiscoveryError
      ? `${error.status}:${error.message}`
      : "unexpected-discovery-failure";
  return createHash("sha256").update(evidence).digest("hex");
}

function normalizePositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(
      `Receipt trust anchor directory subscription ${label} is invalid`,
    );
  }
  return value;
}
