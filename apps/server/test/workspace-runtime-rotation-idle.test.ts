import { describe, expect, it, vi } from "vitest";

import { createServices } from "../src/app.js";
import { createWorkspaceRuntimeHost } from "../src/workspace-runtime-host.js";
import { disposeWorkspaceRuntimeServices } from "../src/workspace-runtime-services.js";
import { processReadySandbox } from "./process-run-readiness-test-fixture.js";
import { seedRotationWorkspace, type RotationFixtureOptions } from "./receipt-trust-worker-test-fixture.js";
import { deferred, runtimeFixture } from "./workspace-runtime-test-fixture.js";

describe("production host rotation-aware idle reclamation", () => {
  it("reclaims paused settled rotation and historical baseline, cold-reopens its data root, and retains another workspace's automation", async () => {
    const f = await rotationHost({ approval: "applied", policyApproval: "failed" }, true);
    const a = f.graphs.get(f.a.root)!;
    const b = f.graphs.get(f.b.root)!;
    const close = vi.spyOn(a.store, "shutdown");
    try {
      const thread = await b.store.createThread({ title: "Future work", agentId: b.store.listAgents()[0]!.id });
      const schedule = await b.store.createSchedule({
        name: "Future automation", threadId: thread.id, prompt: "Keep this workspace resident.",
        model: { provider: "napier", id: "demo" },
        trigger: { type: "interval", everyMs: 60_000, anchorAt: new Date(Date.now() + 3_600_000).toISOString() },
      });
      expect(a.store.receiptTrustRotationSubscriptionRepository.backgroundWork()).toEqual(emptyWork());
      expect(a.store.listReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselines()).toHaveLength(1);
      expect(a.receiptTrustDirectorySubscriptions.hasPendingWork()).toBe(false);
      expect((await f.host.reclaimIdle()).sort()).toEqual([f.a.workspaceId, f.c.workspaceId].sort());
      expect(close).toHaveBeenCalledOnce();
      await expect(a.store.listEvents(f.fixture.thread.id)).rejects.toThrow();
      const response = await f.host.fetch(new Request(`http://localhost/api/workspaces/${f.a.workspaceId}/bootstrap`));
      expect(response.status).toBe(200);
      expect((await response.json()).workspace.dataRoot).toBe(f.a.dataRoot);
      const reopened = f.graphs.get(f.a.root)!;
      expect(reopened).not.toBe(a);
      expect(reopened.store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(f.fixture.subscriptions[0]!.id).status).toBe("paused");
      expect(reopened.store.listReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselines()[0]!.contentSha256).toBe(f.fixture.baselines[0]!.contentSha256);
      expect(b.store.getSchedule(schedule.id).status).toBe("active");
      expect(f.fetcher).not.toHaveBeenCalled();
    } finally { close.mockRestore(); await f.cleanup(); }
  });

  it.each([
    { name: "active rotation subscription", options: { status: "active" }, count: "activeSubscriptions" },
    { name: "paused future approval", options: { approval: "pending" }, count: "pendingApprovalApplies" },
    { name: "paused future policy approval", options: { policyApproval: "pending" }, count: "pendingApprovalPolicyApplies" },
    { name: "paused live refresh claim", options: { claim: "live" }, count: "refreshClaims" },
    { name: "paused expired refresh claim", options: { claim: "expired" }, count: "refreshClaims" },
  ] satisfies Array<{ name: string; options: RotationFixtureOptions; count: keyof ReturnType<typeof emptyWork> }>)("retains $name without exposing private queue state", async ({ options, count }) => {
    const f = await rotationHost(options);
    try {
      const a = f.graphs.get(f.a.root)!;
      expect(a.store.receiptTrustRotationSubscriptionRepository.backgroundWork()).toEqual({ ...emptyWork(), [count]: 1 });
      expect(a.receiptTrustDirectorySubscriptions.hasPendingWork()).toBe(true);
      const projection = a.store.listReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions()[0]!;
      expect(projection).not.toHaveProperty("claim");
      expect(projection).not.toHaveProperty("pendingApprovalApply");
      expect(projection).not.toHaveProperty("pendingApprovalPolicyApply");
      expect((await f.host.reclaimIdle()).sort()).toEqual([f.b.workspaceId, f.c.workspaceId].sort());
      expect(await a.store.listEvents(f.fixture.thread.id)).toEqual([]);
      expect(f.fetcher).not.toHaveBeenCalled();
    } finally { await f.cleanup(); }
  });

  it.each(["claim preparation", "discovery", "audit persistence"] as const)("retains a paused graph during manual refresh %s, then reclaims after settlement", async (stage) => {
    const entered = deferred<void>();
    const release = deferred<void>();
    let holdFetch = false;
    const f = await rotationHost({}, false, async () => {
      if (holdFetch) { entered.resolve(); await release.promise; }
      return Response.json({});
    });
    const a = f.graphs.get(f.a.root)!;
    const subscription = f.fixture.subscriptions[0]!;
    const claim = a.store.claimReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription.bind(a.store);
    const claimSpy = vi.spyOn(a.store, "claimReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription")
      .mockImplementation(async (...args) => {
        if (stage === "claim preparation") { entered.resolve(); await release.promise; }
        return claim(...args);
      });
    const append = a.store.appendEvent.bind(a.store);
    const appendSpy = vi.spyOn(a.store, "appendEvent").mockImplementation(async (input) => {
      if (stage === "audit persistence") { entered.resolve(); await release.promise; }
      return append(input);
    });
    let refreshing: Promise<unknown> | undefined;
    try {
      holdFetch = stage === "discovery";
      refreshing = a.receiptTrustDirectorySubscriptions.refreshRotationProposal(subscription.id, f.fixture.thread.id, subscription.revision);
      await entered.promise;
      expect(a.receiptTrustDirectorySubscriptions.hasPendingWork()).toBe(true);
      if (stage !== "discovery") expect(a.store.receiptTrustRotationSubscriptionRepository.backgroundWork()).toEqual(emptyWork());
      expect((await f.host.reclaimIdle()).sort()).toEqual([f.b.workspaceId, f.c.workspaceId].sort());
      expect(await a.store.listEvents(f.fixture.thread.id)).toEqual([]);
      release.resolve(); await refreshing;
      expect(a.receiptTrustDirectorySubscriptions.hasPendingWork()).toBe(false);
      expect(await a.store.listEvents(f.fixture.thread.id)).toHaveLength(1);
      expect(await f.host.reclaimIdle()).toEqual([f.a.workspaceId]);
    } finally {
      release.resolve(); await refreshing?.catch(() => undefined);
      claimSpy.mockRestore(); appendSpy.mockRestore(); await f.cleanup();
    }
  });

  it.each(["settlement", "audit"] as const)("retains the graph and real store when manual %s persistence fails", async (failureAt) => {
    const f = await rotationHost();
    const a = f.graphs.get(f.a.root)!;
    const subscription = f.fixture.subscriptions[0]!;
    const failure = new Error(`${failureAt} persistence unavailable`);
    const settle = a.store.settleReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionClaim.bind(a.store);
    const settleSpy = vi.spyOn(a.store, "settleReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionClaim")
      .mockImplementation(async (...args) => { if (failureAt === "settlement") throw failure; return settle(...args); });
    const append = a.store.appendEvent.bind(a.store);
    const appendSpy = vi.spyOn(a.store, "appendEvent").mockImplementation(async (input) => {
      if (failureAt === "audit") throw failure;
      return append(input);
    });
    const shutdown = vi.spyOn(a, "shutdownLocalRuntime");
    const storeShutdown = vi.spyOn(a.store, "shutdown");
    try {
      await expect(a.receiptTrustDirectorySubscriptions.refreshRotationProposal(subscription.id, f.fixture.thread.id, subscription.revision)).rejects.toBe(failure);
      if (failureAt === "audit") expect(a.store.receiptTrustRotationSubscriptionRepository.backgroundWork()).toEqual(emptyWork());
      expect(a.receiptTrustDirectorySubscriptions.hasPendingWork()).toBe(true);
      expect((await f.host.reclaimIdle()).sort()).toEqual([f.b.workspaceId, f.c.workspaceId].sort());
      await expect(disposeWorkspaceRuntimeServices(a)).rejects.toThrow("workers did not drain");
      expect(shutdown).not.toHaveBeenCalled(); expect(storeShutdown).not.toHaveBeenCalled();
      expect(await a.store.listEvents(f.fixture.thread.id)).toEqual([]);
    } finally {
      settleSpy.mockRestore(); appendSpy.mockRestore(); shutdown.mockRestore(); storeShutdown.mockRestore();
      // Assertions above preserve the sticky failure. Only teardown bypasses its
      // already-drained stop rejection so the fixture's real ledgers can close.
      const stop = vi.spyOn(a.receiptTrustDirectorySubscriptions, "stop").mockResolvedValue(undefined);
      try { await f.cleanup(); } finally { stop.mockRestore(); }
    }
  });
});

function emptyWork() {
  return { activeSubscriptions: 0, refreshClaims: 0, pendingApprovalApplies: 0, pendingApprovalPolicyApplies: 0 };
}

async function rotationHost(options: RotationFixtureOptions = {}, baseline = false, fetch?: (url: string) => Promise<Response>) {
  const f = await runtimeFixture();
  const fixture = await seedRotationWorkspace(f.a, [options], baseline);
  const graphs = new Map<string, Awaited<ReturnType<typeof createServices>>>();
  const fetcher = vi.fn(fetch ?? (async () => Response.json({})));
  const host = await createWorkspaceRuntimeHost({
    workspaceRoot: f.a.root, stateHome: f.stateHome, maxIdle: 0,
    services: {
      env: {}, sandbox: processReadySandbox("rotation-idle"),
      receiptTrustDirectoryDiscovery: {
        allowedOrigins: ["https://rotation.example.test"], validateEndpoint: async () => undefined, fetcher,
      },
    },
  }, async (input) => {
    const services = await createServices(input);
    graphs.set(services.store.getWorkspaceSummary().root, services);
    return services;
  });
  await Promise.all([...graphs.values()].map((services) => services.receiptTrustDirectorySubscriptions.refreshDue()));
  return { ...f, fixture, graphs, fetcher, host, async cleanup() { try { await host.shutdown(); } finally { await f.cleanup(); } } };
}
