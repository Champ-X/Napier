import { rename, symlink } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { WorkspaceRuntimeCatalog } from "../src/workspace-runtime-catalog.js";
import { resolveWorkspaceRuntimeIdentity } from "../src/workspace-runtime-identity.js";
import { WorkspaceRuntimeRegistry } from "../src/workspace-runtime-registry.js";
import { deferred, runtimeFixture, type TestRuntime } from "./workspace-runtime-test-fixture.js";

describe("workspace runtime registry", () => {
  it("deduplicates concurrent preparation and keeps leases independently pinned", async () => {
    const gate = deferred<TestRuntime>();
    const fixture = await runtimeFixture({ prepare: async () => gate.promise, maxIdle: 0 });
    const first = fixture.registry.acquire(fixture.a.workspaceId);
    const second = fixture.registry.acquire(fixture.a.workspaceId);
    gate.resolve({ name: "a", busy: false });
    const [left, right] = await Promise.all([first, second]);
    try {
      expect(left.runtime).toBe(right.runtime);
      expect(fixture.prepared).toEqual(["a"]);
      left.release(); left.release();
      expect(await fixture.registry.reclaimIdle()).toEqual([]);
      right.release();
      expect(await fixture.registry.reclaimIdle()).toEqual([fixture.a.workspaceId]);
      expect(fixture.disposed).toEqual(["a"]);
    } finally { left.release(); right.release(); await fixture.cleanup(); }
  });

  it("retains active/background work under capacity pressure and evicts only idle runtimes", async () => {
    const f = await runtimeFixture({ maxResident: 2 });
    const a = await f.registry.acquire(f.a.workspaceId);
    const b = await f.registry.acquire(f.b.workspaceId);
    try {
      a.runtime.busy = true;
      a.release();
      await expect(f.registry.acquire(f.c.workspaceId)).rejects.toThrow("capacity");
      expect(f.disposed).toEqual([]);
      b.release();
      const c = await f.registry.acquire(f.c.workspaceId);
      expect(f.disposed).toEqual(["b"]);
      c.release();
      f.advance(101);
      expect(await f.registry.reclaimIdle()).toEqual([f.c.workspaceId]);
      expect(f.disposed).not.toContain("a");
      a.runtime.busy = false;
      expect(await f.registry.reclaimIdle()).toEqual([f.a.workspaceId]);
    } finally { a.release(); b.release(); await f.cleanup(); }
  });

  it("counts pending cold starts toward capacity and recovers after preparation fails", async () => {
    const gate = deferred<TestRuntime>();
    const started = deferred<void>();
    let fail = true;
    const f = await runtimeFixture({ maxResident: 1, prepare: async (name) => {
      if (fail) { started.resolve(); return gate.promise; }
      return { name, busy: false };
    } });
    const pending = f.registry.acquire(f.a.workspaceId);
    await expect(f.registry.acquire(f.b.workspaceId)).rejects.toThrow("capacity");
    await started.promise;
    const rejection = expect(pending).rejects.toThrow("prepare failed");
    gate.reject(new Error("prepare failed"));
    await rejection;
    fail = false;
    const lease = await f.registry.acquire(f.a.workspaceId);
    lease.release();
    await f.cleanup();
  });

  it("waits for disposal before preparing the same workspace again", async () => {
    const gate = deferred<void>();
    const started = deferred<void>();
    const f = await runtimeFixture({ maxIdle: 0, dispose: async () => {
      started.resolve(); await gate.promise;
    } });
    const a = await f.registry.acquire(f.a.workspaceId); a.release();
    const trim = f.registry.reclaimIdle();
    await started.promise;
    const again = f.registry.acquire(f.a.workspaceId);
    expect(f.prepared).toEqual(["a"]);
    gate.resolve();
    await trim;
    const lease = await again;
    expect(f.prepared).toEqual(["a", "a"]);
    lease.release();
    await f.cleanup();
  });

  it("rechecks other candidates after an awaited disposal", async () => {
    const gate = deferred<void>();
    const started = deferred<void>();
    const f = await runtimeFixture({ maxIdle: 0, dispose: async (runtime) => {
      if (runtime.name === "a") { started.resolve(); await gate.promise; }
    } });
    const a = await f.registry.acquire(f.a.workspaceId); a.release();
    const b = await f.registry.acquire(f.b.workspaceId); b.release();
    const trim = f.registry.reclaimIdle();
    await started.promise;
    const active = await f.registry.acquire(f.b.workspaceId);
    gate.resolve();
    expect(await trim).toEqual([f.a.workspaceId]);
    active.release();
    await f.cleanup();
  });

  it("quarantines a partially disposed runtime and preserves ownership", async () => {
    let fails = true;
    const f = await runtimeFixture({ maxIdle: 0, dispose: async () => {
      if (fails) throw new Error("shutdown failed");
    } });
    const lease = await f.registry.acquire(f.a.workspaceId); lease.release();
    await expect(f.registry.reclaimIdle()).rejects.toThrow("shutdown failed");
    await expect(f.registry.acquire(f.a.workspaceId)).rejects.toThrow("reconciliation");
    const other = await WorkspaceRuntimeCatalog.open(f.stateHome);
    try { expect(() => other.claim(f.a.workspaceId)).toThrow("live server"); }
    finally { other.close(); }
    fails = false;
    await f.cleanup();
  });

  it("drains request leases during shutdown and rejects new admission", async () => {
    const f = await runtimeFixture();
    const lease = await f.registry.acquire(f.a.workspaceId);
    const shutdown = f.registry.shutdown();
    await expect(f.registry.acquire(f.b.workspaceId)).rejects.toThrow("shutting down");
    expect(f.disposed).toEqual([]);
    lease.release();
    await shutdown;
    expect(f.disposed).toEqual(["a"]);
    await f.cleanup();
  });

  it("restores all workspace identities and custom ledgers after reopening", async () => {
    const f = await runtimeFixture();
    expect(await f.registry.restore()).toEqual([]);
    expect(f.prepared).toEqual(["a", "b", "c"]);
    await f.registry.shutdown();
    const reopened = await WorkspaceRuntimeCatalog.open(f.stateHome);
    const restored: string[] = [];
    const registry = new WorkspaceRuntimeRegistry({
      catalog: reopened,
      prepare: async (identity) => { restored.push(identity.dataRoot); return identity; },
      dispose: async () => undefined, canDispose: () => true,
    });
    try {
      expect(await registry.restore()).toEqual([]);
      expect(restored).toEqual([f.a.dataRoot, f.b.dataRoot, f.c.dataRoot]);
    } finally { await registry.shutdown(); reopened.close(); await f.cleanup(); }
  });

  it("deduplicates aliases and rejects a different ledger or reused data root", async () => {
    const f = await runtimeFixture();
    try {
      const alias = path.join(f.directory, "alias");
      await symlink(f.a.root, alias);
      expect(f.catalog.register(await resolveWorkspaceRuntimeIdentity(alias, f.a.dataRoot))).toEqual(f.a);
      const different = await resolveWorkspaceRuntimeIdentity(f.a.root, path.join(f.directory, "other-data"));
      expect(() => f.catalog.register(different)).toThrow("different data root");
      const shared = await resolveWorkspaceRuntimeIdentity(f.b.root, f.a.dataRoot);
      expect(() => f.catalog.register(shared)).toThrow();
      expect(f.catalog.list()).toHaveLength(3);
    } finally { await f.cleanup(); }
  });

  it("fails closed on a missing or retargeted data root without affecting other workspaces", async () => {
    const f = await runtimeFixture();
    await rename(f.a.dataRoot, `${f.a.dataRoot}-saved`);
    await symlink(f.b.dataRoot, f.a.dataRoot);
    try {
      const failures = await f.registry.restore();
      expect(failures).toEqual([{ workspaceId: f.a.workspaceId, error: expect.stringContaining("identity changed") }]);
      expect(f.prepared).toEqual(["b", "c"]);
    } finally { await f.cleanup(); }
  });

  it("does not let another live catalog owner initialize the same ledger", async () => {
    const f = await runtimeFixture();
    const other = await WorkspaceRuntimeCatalog.open(f.stateHome);
    const a = await f.registry.acquire(f.a.workspaceId);
    try {
      expect(() => other.claim(f.a.workspaceId)).toThrow("live server");
      other.release(f.a.workspaceId);
      expect(() => other.claim(f.a.workspaceId)).toThrow("live server");
      a.release(); await f.registry.shutdown();
      expect(() => other.claim(f.a.workspaceId)).not.toThrow();
      other.release(f.a.workspaceId);
    } finally { a.release(); other.close(); await f.cleanup(); }
  });
});
