import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LocalStore } from "../src/index.js";
import {
  ToolConcurrencyDurableLeaseFencedError,
  ToolConcurrencyGate,
} from "../src/tool-concurrency-gate.js";

const temporaryRoots: string[] = [];
const openStores: LocalStore[] = [];

afterEach(async () => {
  for (const store of openStores.splice(0)) store.close();
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("durable tool concurrency leases", () => {
  it("serializes hierarchical resources across two LocalStore facades", async () => {
    const [firstStore, secondStore] = await openSharedStores();
    const firstGate = gate(firstStore, "owner:first");
    const secondGate = gate(secondStore, "owner:second");
    const firstStarted = deferred<void>();
    const releaseFirst = deferred<void>();
    const secondStarted = deferred<void>();

    const first = firstGate.runWithResources(
      "call:first",
      [{ key: ["workspace"], mode: "serialized" }],
      undefined,
      async () => {
        firstStarted.resolve();
        await releaseFirst.promise;
      },
    );
    await firstStarted.promise;
    const second = secondGate.runWithResources(
      "call:second",
      [{ key: ["workspace", "file.ts"], mode: "serialized" }],
      undefined,
      async () => secondStarted.resolve(),
    );

    await delay(40);
    expect(secondStarted.settled()).toBe(false);
    releaseFirst.resolve();
    await Promise.all([first, second]);
    expect(secondStarted.settled()).toBe(true);
  });

  it("does not serialize unrelated resources in the same workspace", async () => {
    const [firstStore, secondStore] = await openSharedStores();
    const firstStarted = deferred<void>();
    const secondStarted = deferred<void>();
    const release = deferred<void>();

    const first = gate(firstStore, "owner:first").runWithResources(
      "call:first",
      [{ key: ["workspace", "a.ts"], mode: "exclusive" }],
      undefined,
      async () => {
        firstStarted.resolve();
        await release.promise;
      },
    );
    const second = gate(secondStore, "owner:second").runWithResources(
      "call:second",
      [{ key: ["browser", "session-2"], mode: "exclusive" }],
      undefined,
      async () => {
        secondStarted.resolve();
        await release.promise;
      },
    );

    await Promise.all([firstStarted.promise, secondStarted.promise]);
    release.resolve();
    await Promise.all([first, second]);
  });

  it("scopes identical resource keys to each workspace ledger", async () => {
    const [firstWorkspace] = await openSharedStores();
    const [secondWorkspace] = await openSharedStores();
    const firstStarted = deferred<void>();
    const secondStarted = deferred<void>();
    const release = deferred<void>();

    const first = gate(firstWorkspace, "owner:first").runWithResources(
      "call:first",
      [{ key: ["workspace"], mode: "exclusive" }],
      undefined,
      async () => {
        firstStarted.resolve();
        await release.promise;
      },
    );
    const second = gate(secondWorkspace, "owner:second").runWithResources(
      "call:second",
      [{ key: ["workspace"], mode: "exclusive" }],
      undefined,
      async () => {
        secondStarted.resolve();
        await release.promise;
      },
    );

    await Promise.all([firstStarted.promise, secondStarted.promise]);
    release.resolve();
    await Promise.all([first, second]);
  });

  it("preserves safe and serialized mode compatibility across stores", async () => {
    const [firstStore, secondStore] = await openSharedStores();
    const safeStarted = deferred<void>();
    const serializedStarted = deferred<void>();
    const release = deferred<void>();

    const safe = gate(firstStore, "owner:safe").runWithResources(
      "call:safe",
      [{ key: ["network", "public"], mode: "safe" }],
      undefined,
      async () => {
        safeStarted.resolve();
        await release.promise;
      },
    );
    await safeStarted.promise;
    const serialized = gate(secondStore, "owner:serialized").runWithResources(
      "call:serialized",
      [{ key: ["network", "public"], mode: "serialized" }],
      undefined,
      async () => {
        serializedStarted.resolve();
        await release.promise;
      },
    );

    await serializedStarted.promise;
    release.resolve();
    await Promise.all([safe, serialized]);
  });

  it("inherits a durable ancestor lease without self-deadlocking", async () => {
    const [store] = await openSharedStores();
    const durableGate = gate(store, "owner:nested");

    await expect(
      durableGate.runWithResources(
        "call:parent",
        [{ key: ["workspace"], mode: "serialized" }],
        undefined,
        () =>
          durableGate.runWithResources(
            "call:child",
            [{ key: ["workspace", "file.ts"], mode: "serialized" }],
            undefined,
            async () => "completed",
          ),
      ),
    ).resolves.toBe("completed");
  });

  it("claims multiple resources atomically without reserving a partial set", async () => {
    const [firstStore, secondStore] = await openSharedStores();
    const resourceBHeld = deferred<void>();
    const releaseB = deferred<void>();
    const multiStarted = deferred<void>();
    const resourceAReached = deferred<void>();

    const holdB = gate(firstStore, "owner:b").runWithResources(
      "call:hold-b",
      [{ key: ["resource", "b"], mode: "exclusive" }],
      undefined,
      async () => {
        resourceBHeld.resolve();
        await releaseB.promise;
      },
    );
    await resourceBHeld.promise;
    const multi = gate(secondStore, "owner:multi").runWithResources(
      "call:a-and-b",
      [
        { key: ["resource", "a"], mode: "exclusive" },
        { key: ["resource", "b"], mode: "exclusive" },
      ],
      undefined,
      async () => multiStarted.resolve(),
    );
    const claimA = gate(firstStore, "owner:a").runWithResources(
      "call:a",
      [{ key: ["resource", "a"], mode: "exclusive" }],
      undefined,
      async () => resourceAReached.resolve(),
    );

    await resourceAReached.promise;
    expect(multiStarted.settled()).toBe(false);
    releaseB.resolve();
    await Promise.all([holdB, claimA, multi]);
    expect(multiStarted.settled()).toBe(true);
  });

  it("renews a healthy lease beyond its initial TTL", async () => {
    const [firstStore, secondStore] = await openSharedStores();
    const firstGate = gate(firstStore, "owner:first", 120, 25, 5);
    const secondGate = gate(secondStore, "owner:second", 120, 25, 5);
    const firstStarted = deferred<void>();
    const releaseFirst = deferred<void>();
    const secondStarted = deferred<void>();

    const first = firstGate.runWithResources(
      "call:first",
      [{ key: ["workspace"], mode: "exclusive" }],
      undefined,
      async () => {
        firstStarted.resolve();
        await releaseFirst.promise;
      },
    );
    await firstStarted.promise;
    const second = secondGate.runWithResources(
      "call:second",
      [{ key: ["workspace"], mode: "safe" }],
      undefined,
      async () => secondStarted.resolve(),
    );

    await delay(260);
    expect(secondStarted.settled()).toBe(false);
    releaseFirst.resolve();
    await Promise.all([first, second]);
  });

  it("cancels a durable waiter without leaking an authorization", async () => {
    const [firstStore, secondStore] = await openSharedStores();
    const held = deferred<void>();
    const release = deferred<void>();
    const first = gate(firstStore, "owner:first").runWithResources(
      "call:first",
      [{ key: ["workspace"], mode: "exclusive" }],
      undefined,
      async () => {
        held.resolve();
        await release.promise;
      },
    );
    await held.promise;

    const controller = new AbortController();
    let executed = false;
    const cancelled = gate(secondStore, "owner:cancelled").runWithResources(
      "call:cancelled",
      [{ key: ["workspace"], mode: "safe" }],
      controller.signal,
      async () => {
        executed = true;
      },
    );
    await delay(20);
    controller.abort(new Error("cancel durable waiter"));
    await expect(cancelled).rejects.toThrow("cancel durable waiter");
    expect(executed).toBe(false);

    release.resolve();
    await first;
    await expect(
      gate(secondStore, "owner:replacement").runWithResources(
        "call:replacement",
        [{ key: ["workspace"], mode: "exclusive" }],
        undefined,
        async () => "admitted",
      ),
    ).resolves.toBe("admitted");
  });

  it("takes over an expired crash lease and fences its stale owner", async () => {
    const [firstStore, secondStore] = await openSharedStores();
    const firstBackend = firstStore.toolConcurrencyLeaseBackend();
    const secondBackend = secondStore.toolConcurrencyLeaseBackend();
    const firstClaim = await firstBackend.claim({
      leaseId: "lease:first",
      ownerId: "owner:first",
      operationId: "call:first",
      requirements: [{ key: ["workspace"], mode: "exclusive" }],
      ancestorLeases: [],
      nowMs: 1_000,
      expiresAtMs: 1_100,
    });
    expect(firstClaim.status).toBe("acquired");
    if (firstClaim.status !== "acquired") throw new Error("claim failed");
    const restartOptions = {
      dataRoot: firstStore.dataRoot,
      workspaceRoot: firstStore.workspaceRoot,
    };
    firstStore.close();
    openStores.splice(openStores.indexOf(firstStore), 1);
    const restartedStore = new LocalStore(restartOptions);
    openStores.push(restartedStore);
    await restartedStore.initialize();
    const staleOwnerBackend = restartedStore.toolConcurrencyLeaseBackend();

    const secondClaim = await secondBackend.claim({
      leaseId: "lease:second",
      ownerId: "owner:second",
      operationId: "call:second",
      requirements: [{ key: ["workspace", "file.ts"], mode: "serialized" }],
      ancestorLeases: [],
      nowMs: 1_101,
      expiresAtMs: 1_301,
    });
    expect(secondClaim.status).toBe("acquired");
    if (secondClaim.status !== "acquired") throw new Error("takeover failed");
    expect(secondClaim.lease.generation).toBeGreaterThan(
      firstClaim.lease.generation,
    );

    await expect(
      Promise.resolve().then(() =>
        staleOwnerBackend.renew({
          lease: firstClaim.lease,
          nowMs: 1_102,
          expiresAtMs: 1_302,
        }),
      ),
    ).rejects.toBeInstanceOf(ToolConcurrencyDurableLeaseFencedError);
    await expect(
      Promise.resolve().then(() =>
        staleOwnerBackend.release({ lease: firstClaim.lease, nowMs: 1_102 }),
      ),
    ).rejects.toBeInstanceOf(ToolConcurrencyDurableLeaseFencedError);
    await expect(
      Promise.resolve().then(() =>
        staleOwnerBackend.assertCurrent({
          lease: firstClaim.lease,
          nowMs: 1_102,
        }),
      ),
    ).rejects.toBeInstanceOf(ToolConcurrencyDurableLeaseFencedError);
    await expect(
      Promise.resolve(
        secondBackend.assertCurrent({
          lease: secondClaim.lease,
          nowMs: 1_102,
        }),
      ),
    ).resolves.toMatchObject({ generation: secondClaim.lease.generation });
  });

  it("rejects a result when its lease is fenced during execution", async () => {
    const [firstStore, secondStore] = await openSharedStores();
    let now = 1_000;
    const started = deferred<void>();
    const finish = deferred<void>();
    const firstGate = new ToolConcurrencyGate({
      durable: {
        backend: firstStore.toolConcurrencyLeaseBackend(),
        ownerId: "owner:first",
        leaseTtlMs: 100,
        heartbeatIntervalMs: 99,
        pollIntervalMs: 5,
        now: () => now,
      },
    });
    const first = firstGate.runWithResources(
      "call:first",
      [{ key: ["workspace"], mode: "exclusive" }],
      undefined,
      async () => {
        started.resolve();
        await finish.promise;
        return "stale result";
      },
    );
    await started.promise;

    now = 1_101;
    const takeover = await secondStore.toolConcurrencyLeaseBackend().claim({
      leaseId: "lease:takeover",
      ownerId: "owner:second",
      operationId: "call:second",
      requirements: [{ key: ["workspace"], mode: "exclusive" }],
      ancestorLeases: [],
      nowMs: now,
      expiresAtMs: now + 100,
    });
    expect(takeover.status).toBe("acquired");
    finish.resolve();

    await expect(first).rejects.toBeInstanceOf(
      ToolConcurrencyDurableLeaseFencedError,
    );
  });
});

function gate(
  store: LocalStore,
  ownerId: string,
  leaseTtlMs = 1_000,
  heartbeatIntervalMs = 100,
  pollIntervalMs = 5,
): ToolConcurrencyGate {
  return new ToolConcurrencyGate({
    durable: {
      backend: store.toolConcurrencyLeaseBackend(),
      ownerId,
      leaseTtlMs,
      heartbeatIntervalMs,
      pollIntervalMs,
    },
  });
}

async function openSharedStores(): Promise<[LocalStore, LocalStore]> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-tool-concurrency-"));
  temporaryRoots.push(root);
  const options = {
    dataRoot: path.join(root, "data"),
    workspaceRoot: path.join(root, "workspace"),
  };
  const first = new LocalStore(options);
  openStores.push(first);
  await first.initialize();
  const second = new LocalStore(options);
  openStores.push(second);
  await second.initialize();
  return [first, second];
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  let complete = false;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = (value) => {
      complete = true;
      promiseResolve(value);
    };
    reject = (reason) => {
      complete = true;
      promiseReject(reason);
    };
  });
  return { promise, resolve, reject, settled: () => complete };
}

async function delay(durationMs: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, durationMs));
}
