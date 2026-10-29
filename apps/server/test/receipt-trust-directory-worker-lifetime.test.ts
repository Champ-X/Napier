import { setImmediate } from "node:timers/promises";

import { LocalStore } from "@napier/runtime/store";
import { describe, expect, it, vi } from "vitest";

import { ReceiptTrustAnchorDirectoryDiscoveryService } from "../src/receipt-trust-directory-discovery.js";
import { ReceiptTrustAnchorDirectorySubscriptionService } from "../src/receipt-trust-directory-subscriptions.js";
import { seedRotationWorkspace } from "./receipt-trust-worker-test-fixture.js";
import { deferred, runtimeFixture } from "./workspace-runtime-test-fixture.js";

describe("receipt trust worker lifetime", () => {
  it.each(["settlement", "audit"] as const)("drains a delayed sibling before reporting %s persistence failure", async (failureAt) => {
    const f = await runtimeFixture();
    const fixture = await seedRotationWorkspace(f.a, [{ status: "active", due: true }, { status: "active", due: true }]);
    const store = new LocalStore(fixture.storeOptions);
    await store.initialize();
    const blocked = deferred<void>();
    const release = deferred<void>();
    const failed = deferred<void>();
    const siblingFinished = deferred<void>();
    let siblingStarted = false;
    const failure = new Error(`${failureAt} persistence unavailable`);
    const firstId = fixture.subscriptions[0]!.id;
    const secondId = fixture.subscriptions[1]!.id;
    const discovery = new ReceiptTrustAnchorDirectoryDiscoveryService({
      allowedOrigins: ["https://rotation.example.test"], validateEndpoint: async () => undefined,
      fetcher: async (url) => {
        if (url.endsWith("proposal-1.json")) { siblingStarted = true; blocked.resolve(); await release.promise; }
        return Response.json({});
      },
    });
    const worker = new ReceiptTrustAnchorDirectorySubscriptionService(store, discovery);
    const settle = store.settleReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionClaim.bind(store);
    const settleSpy = vi.spyOn(store, "settleReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionClaim")
      .mockImplementation(async (...args) => {
        if (failureAt === "settlement" && args[0] === firstId) { failed.resolve(); throw failure; }
        try { return await settle(...args); }
        catch (error) { if (args[0] === secondId) siblingFinished.resolve(); throw error; }
      });
    const append = store.appendEvent.bind(store);
    const appendSpy = vi.spyOn(store, "appendEvent").mockImplementation(async (input) => {
      if (failureAt === "audit" && input.payload["subscriptionId"] === firstId) { failed.resolve(); throw failure; }
      try { return await append(input); }
      finally { if (input.payload["subscriptionId"] === secondId) siblingFinished.resolve(); }
    });
    try {
      worker.start();
      await Promise.all([blocked.promise, failed.promise]);
      const stopping = worker.stop();
      const observed = stopping.then(() => ({ error: undefined }), (error: unknown) => ({ error }));
      let stopped = false;
      void observed.then(() => { stopped = true; });
      await setImmediate();
      expect(stopped).toBe(false);
      expect(worker.stop()).toBe(stopping);
      expect(worker.hasPendingWork()).toBe(true);
      expect(settleSpy.mock.calls.some(([id]) => id === secondId)).toBe(false);
      await expect(worker.refreshDue()).rejects.toThrow("stopped");
      release.resolve();
      const result = await observed;
      expect(nestedErrors(result.error)).toContain(failure);
      expect(settleSpy.mock.calls.some(([id]) => id === secondId)).toBe(true);
      expect((await store.listEvents(fixture.thread.id)).some(({ payload }) =>
        payload !== null && typeof payload === "object" && !Array.isArray(payload) && payload["subscriptionId"] === secondId,
      )).toBe(true);
      expect(worker.hasPendingWork()).toBe(true);
      await expect(worker.stop()).rejects.toBe(result.error);
    } finally {
      release.resolve();
      await worker.stop().catch(() => undefined);
      if (siblingStarted) await siblingFinished.promise;
      settleSpy.mockRestore(); appendSpy.mockRestore();
      store.close(); await f.cleanup();
    }
  });

  it("does not retain a rejected manual claim, but owns successful claim preparation through shutdown", async () => {
    const f = await runtimeFixture();
    const fixture = await seedRotationWorkspace(f.a);
    const store = new LocalStore(fixture.storeOptions);
    await store.initialize();
    const discovery = new ReceiptTrustAnchorDirectoryDiscoveryService({
      allowedOrigins: ["https://rotation.example.test"], validateEndpoint: async () => undefined,
      fetcher: async () => Response.json({}),
    });
    const worker = new ReceiptTrustAnchorDirectorySubscriptionService(store, discovery);
    const subscription = fixture.subscriptions[0]!;
    const entered = deferred<void>();
    const release = deferred<void>();
    let holdClaim = false;
    const claim = store.claimReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription.bind(store);
    const claimSpy = vi.spyOn(store, "claimReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription")
      .mockImplementation(async (...args) => {
        if (holdClaim) { entered.resolve(); await release.promise; }
        return claim(...args);
      });
    try {
      await expect(worker.refreshRotationProposal(subscription.id, fixture.thread.id, subscription.revision + 1)).rejects.toThrow("revision changed");
      expect(worker.hasPendingWork()).toBe(false);
      holdClaim = true;
      const refreshing = worker.refreshRotationProposal(subscription.id, fixture.thread.id, subscription.revision);
      await entered.promise;
      expect(worker.hasPendingWork()).toBe(true);
      const stopping = worker.stop();
      const claimsBeforeStop = claimSpy.mock.calls.length;
      await expect(worker.refreshRotationProposal(subscription.id, fixture.thread.id, subscription.revision)).rejects.toThrow("stopped");
      expect(claimSpy).toHaveBeenCalledTimes(claimsBeforeStop);
      let stopped = false;
      void stopping.then(() => { stopped = true; });
      await setImmediate();
      expect(stopped).toBe(false);
      release.resolve();
      await refreshing; await stopping;
      expect(worker.hasPendingWork()).toBe(false);
      expect(await store.listEvents(fixture.thread.id)).toHaveLength(1);
    } finally {
      release.resolve(); await worker.stop().catch(() => undefined);
      claimSpy.mockRestore(); store.close(); await f.cleanup();
    }
  });
});

function nestedErrors(error: unknown): unknown[] {
  return error instanceof AggregateError ? error.errors.flatMap(nestedErrors) : [error];
}
