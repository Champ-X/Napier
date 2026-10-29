import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceResourceAdmission } from "../src/workspace-resource-admission.js";
import { workspaceResourceLimitsFromEnvironment, type ResourceCleanup } from "../src/workspace-resource-policy.js";

const workspaceA = `workspace_${"a".repeat(64)}`;
const workspaceB = `workspace_${"b".repeat(64)}`;
const homes: string[] = [];
const ledgers: WorkspaceResourceAdmission[] = [];
const releases: Array<() => void> = [];
const request = { kind: "sandbox_execution", backend: "fixture" } as const;
const released: ResourceCleanup = { status: "released", scope: "sandbox_execution", reason: "fixture_cleanup" };
const noStart: ResourceCleanup = { ...released, status: "not_started" };
async function home() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "napier-resource-admission-"));
  homes.push(directory);
  return directory;
}
async function ledger(directory: string, options: Parameters<typeof WorkspaceResourceAdmission.open>[1] = {}) {
  const result = await WorkspaceResourceAdmission.open(directory, options);
  ledgers.push(result);
  return result;
}
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  for (const entry of ledgers.splice(0)) entry.close();
  for (const directory of homes.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe("durable owned execution resource admission", () => {
  it("shares independent resource capacities across workspaces and connections", async () => {
    const directory = await home();
    const a = await ledger(directory, { sandbox_execution: 1 });
    const b = await ledger(directory, { sandbox_execution: 3 });
    const lease = a.forWorkspace(workspaceA).reserve(request);
    releases.push(() => lease.settle(released));
    lease.dispatched();
    lease.bind({ resourceId: "owned-execution", identitySha256: "a".repeat(64) });
    expect(() => b.forWorkspace(workspaceB).reserve(request)).toThrow(expect.objectContaining({ code: "capacity" }));
    const browser = b.forWorkspace(workspaceB).reserve({ kind: "browser_session", backend: "playwright" });
    browser.settle({ status: "not_started", scope: "browser_session", reason: "cancelled_before_launch" });
    expect(b.snapshot()[0]).toMatchObject({ effectiveCapacity: 1, occupied: 1, active: 1 });
    lease.settle(released);
    lease.settle(released);
    expect(a.hasPending(workspaceA)).toBe(false);
    a.close();
    expect(b.snapshot()[0]).toMatchObject({ effectiveCapacity: 3, occupied: 0 });
    // The release cleanup runs before close in normal use; this one already settled.
    releases.pop();
  });

  it("retains a slot and blocks drain after unknown cleanup until affirmative cleanup arrives", async () => {
    const a = await ledger(await home(), { sandbox_execution: 1 });
    const lease = a.forWorkspace(workspaceA).reserve(request);
    releases.push(() => lease.settle(released));
    lease.dispatched();
    const drain = a.drainWorkspace(workspaceA);
    lease.settle({ status: "unknown", scope: "sandbox_execution", reason: "missing_guardian_ack" });
    await expect(drain).rejects.toMatchObject({ code: "cleanup" });
    expect(a.hasPending(workspaceA)).toBe(true);
    expect(a.snapshot()[0]).toMatchObject({ occupied: 1, quarantined: 1 });
    expect(() => a.close()).toThrow(expect.objectContaining({ code: "cleanup" }));
    expect(() => a.forWorkspace(workspaceB).reserve(request)).toThrow(expect.objectContaining({ code: "capacity" }));
    lease.bind({ resourceId: "later-observed-owned-process" });
    lease.settle(released);
    await a.drainWorkspace(workspaceA);
    expect(a.snapshot()[0]).toMatchObject({ occupied: 0, quarantined: 0 });
  });

  it("accepts affirmative no-start evidence and preserves immutable identities and terminal receipts", async () => {
    const a = await ledger(await home());
    const before = a.forWorkspace(workspaceA).reserve(request);
    before.settle(noStart);
    const lease = a.forWorkspace(workspaceA).reserve(request);
    releases.push(() => lease.settle(released));
    lease.dispatched(); lease.dispatched();
    const identity = { resourceId: "first" };
    lease.bind(identity); identity.resourceId = "changed";
    lease.bind({ resourceId: "first" });
    expect(() => lease.bind(identity)).toThrow(expect.objectContaining({ code: "transition" }));
    lease.settle(released);
    expect(() => lease.dispatched()).toThrow(expect.objectContaining({ code: "transition" }));
    expect(() => lease.settle({ ...released, status: "unknown" })).toThrow(expect.objectContaining({ code: "transition" }));
    expect(a.snapshot()[0]?.occupied).toBe(0);
  });

  it("does not release durable capacity when settlement persistence fails", async () => {
    const directory = await home();
    const a = await ledger(directory, { sandbox_execution: 1 });
    const lease = a.forWorkspace(workspaceA).reserve(request);
    releases.push(() => lease.settle(released));
    lease.dispatched();
    const db = new DatabaseSync(path.join(directory, "execution-resources.sqlite"));
    try {
      db.exec("CREATE TRIGGER reject_release BEFORE UPDATE ON execution_resources WHEN NEW.state='released' BEGIN SELECT RAISE(ABORT,'injected accounting failure'); END");
      const drain = a.drainWorkspace(workspaceA);
      expect(() => lease.settle(released)).toThrow("injected accounting failure");
      await expect(drain).rejects.toMatchObject({ code: "accounting" });
      expect(a.snapshot()[0]?.occupied).toBe(1);
      expect(() => a.forWorkspace(workspaceB).reserve(request)).toThrow(expect.objectContaining({ code: "capacity" }));
      db.exec("DROP TRIGGER reject_release");
      lease.settle(released);
      await a.drainWorkspace(workspaceA);
      expect(a.snapshot()[0]?.occupied).toBe(0);
    } finally { db.exec("DROP TRIGGER IF EXISTS reject_release"); db.close(); }
  });

  it.each(["reserved", "dispatched", "bound"])("recovers owner death at %s without inferring post-dispatch cleanup", async (stage) => {
    const directory = await home();
    const child = startHost(directory, stage);
    try {
      expect(await child.ready).toMatchObject({ admitted: true });
      const observer = await ledger(directory, { sandbox_execution: 1 });
      expect(observer.snapshot()[0]?.occupied).toBe(1);
      child.process.kill("SIGKILL");
      expect((await child.exit)[1]).toBe("SIGKILL");
      const beforeDispatch = stage === "reserved";
      expect(observer.snapshot()[0]).toMatchObject({ occupied: beforeDispatch ? 0 : 1, quarantined: beforeDispatch ? 0 : 1 });
      observer.close();
      const reopened = await ledger(directory, { sandbox_execution: 1 });
      expect(reopened.snapshot()[0]?.occupied).toBe(beforeDispatch ? 0 : 1);
      if (beforeDispatch) reopened.forWorkspace(workspaceB).reserve(request).settle(noStart);
      else expect(() => reopened.forWorkspace(workspaceB).reserve(request)).toThrow(expect.objectContaining({ code: "capacity" }));
    } finally { await child.stop(); }
  });

  it("admits exactly one of two independent host processes racing for the same slot", async () => {
    const directory = await home();
    const children = [startHost(directory, "bound"), startHost(directory, "bound")];
    try {
      const results = await Promise.all(children.map((child) => child.ready));
      expect(results.filter((result) => result.admitted)).toHaveLength(1);
      expect(results.find((result) => !result.admitted)).toMatchObject({ code: "capacity" });
      const observer = await ledger(directory, { sandbox_execution: 1 });
      expect(observer.snapshot()[0]?.occupied).toBe(1);
      const winner = children[results.findIndex((result) => result.admitted)]!;
      winner.process.send("release");
      expect((await winner.exit)[0]).toBe(0);
      expect(observer.snapshot()[0]?.occupied).toBe(0);
    } finally { await Promise.all(children.map((child) => child.stop())); }
  });

  it("validates capacity, scope and identity before accepting release evidence", async () => {
    expect(() => workspaceResourceLimitsFromEnvironment({ NAPIER_SANDBOX_MAX_CONCURRENT: "0" })).toThrow();
    expect(() => workspaceResourceLimitsFromEnvironment({ NAPIER_BROWSER_TASK_MAX_CONCURRENT: " 2" })).toThrow();
    expect(workspaceResourceLimitsFromEnvironment({ NAPIER_BROWSER_SESSION_MAX_CONCURRENT: "2" })).toEqual({ browser_session: 2 });
    const a = await ledger(await home());
    expect(() => a.forWorkspace("arbitrary-path")).toThrow();
    const lease = a.forWorkspace(workspaceA).reserve(request);
    releases.push(() => lease.settle(noStart));
    expect(() => lease.bind({ resourceId: "before-dispatch" })).toThrow();
    expect(() => lease.settle(released)).toThrow();
    expect(() => lease.settle({ ...noStart, scope: "browser_task" })).toThrow();
    expect(a.snapshot()[0]?.occupied).toBe(1);
    lease.settle(noStart);
  });

  it.each(["cleanup", "identity"] as const)("rejects drain after malformed %s evidence while retaining capacity", async (kind) => {
    const a = await ledger(await home(), { sandbox_execution: 1 });
    const lease = a.forWorkspace(workspaceA).reserve(request);
    releases.push(() => lease.settle(released));
    lease.dispatched();
    const drain = a.drainWorkspace(workspaceA);
    expect(() => kind === "cleanup"
      ? lease.settle({ ...released, scope: "browser_task" })
      : lease.bind({ resourceId: "", identitySha256: "invalid" })).toThrow("Invalid execution resource");
    await expect(drain).rejects.toMatchObject({ code: "accounting" });
    expect(a.snapshot()[0]?.occupied).toBe(1);
    expect(() => a.forWorkspace(workspaceB).reserve(request)).toThrow(expect.objectContaining({ code: "capacity" }));
    lease.settle(released);
  });

  it.each([123, undefined, { toString: () => "apparently_valid" }])("rejects a non-string cleanup reason without releasing durable capacity (%j)", async (reason) => {
    const a = await ledger(await home(), { sandbox_execution: 1 });
    const lease = a.forWorkspace(workspaceA).reserve(request);
    releases.push(() => lease.settle(released));
    lease.dispatched();
    const drain = a.drainWorkspace(workspaceA);
    expect(() => lease.settle({ ...released, reason } as unknown as ResourceCleanup)).toThrow("Invalid execution resource cleanup evidence");
    await expect(drain).rejects.toMatchObject({ code: "accounting" });
    expect(a.snapshot()[0]?.occupied).toBe(1);
    expect(() => a.forWorkspace(workspaceB).reserve(request)).toThrow(expect.objectContaining({ code: "capacity" }));
    lease.settle(released);
  });
});

function startHost(directory: string, stage: string) {
  const filename = fileURLToPath(new URL("./workspace-resource-admission-process.ts", import.meta.url));
  const child = fork(filename, [directory, stage], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"] });
  let errors = "";
  child.stderr?.on("data", (chunk) => { errors += String(chunk); });
  const exit = once(child, "exit");
  const ready = Promise.race([
    once(child, "message").then(([message]) => message as { admitted: boolean; code?: string }),
    exit.then(() => { throw new Error(`Admission host exited before ready: ${errors}`); }),
  ]);
  return {
    process: child, exit, ready,
    async stop() {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await exit;
    },
  };
}
