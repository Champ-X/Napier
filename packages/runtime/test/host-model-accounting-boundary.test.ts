import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { HostModelAccounting } from "../src/host-model-accounting.js";
import type { HostModelAccountingPolicy } from "../src/host-model-accounting-policy.js";
import { modelAccountingBinding } from "../src/model-accounting-binding.js";
import { modelUsageFixture } from "./model-usage-fixture.js";

const workspaceId = `workspace_${"a".repeat(64)}`;
type Reservation = { id: string; workspaceId: string };
const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

function fixture(override: Partial<HostModelAccountingPolicy<Reservation>> = {}) {
  const db = new DatabaseSync(":memory:"); databases.push(db);
  db.exec("CREATE TABLE policy_calls(id TEXT PRIMARY KEY)");
  const policy: HostModelAccountingPolicy<Reservation> = {
    assertOpen() {}, reserve(id, input) {
      const physicalId = input.attribution?.physicalId ?? "legacy";
      db.prepare("INSERT INTO policy_calls VALUES(?)").run(physicalId);
      return { id: physicalId, workspaceId: id };
    }, settle() {}, undispatched() {}, acknowledge() {}, errorCode: () => undefined,
    isDeclaredZeroCost: () => false, ...override,
  };
  return { db, policy };
}

describe("Host accounting ownership boundary", () => {
  it("rejects database-shaped data without creating native receipt authority", () => {
    const f = fixture();
    for (const fake of [{ exec() {}, prepare: () => ({ get: () => ({ source_id: "forged_source" }) }) }, Object.create(DatabaseSync.prototype)])
      expect(() => HostModelAccounting.attach({ database: fake as DatabaseSync, policy: f.policy })).toThrow("native SQLite database");
    expect(f.db.prepare("SELECT count(*) AS n FROM policy_calls").get()?.["n"]).toBe(0);
  });

  it("keeps receipt operations private and refuses copied attribution at its public admission", () => {
    const f = fixture(), host = HostModelAccounting.attach({ database: f.db, policy: f.policy });
    const admission = host.forWorkspace(workspaceId), binding = modelAccountingBinding(admission)!;
    const call = modelUsageFixture({ sourceId: binding.source.sourceId, hostWorkspaceId: workspaceId });
    expect(Object.getOwnPropertyNames(host)).toEqual([]);
    expect(Reflect.get(host, "source")).toBeUndefined();
    expect(Reflect.get(host, "scopedSource")).toBeUndefined();
    expect(Reflect.get(admission, "usageSource")).toBeUndefined();
    expect(Object.isFrozen(admission)).toBe(true);
    expect(() => admission.reserve({ method: call.attribution.method, model: call.model,
      attribution: structuredClone(call.attribution) })).toThrow("Host model invocation accounting");
    expect(f.db.prepare("SELECT count(*) AS n FROM policy_calls").get()?.["n"]).toBe(0);
    expect(host.hasPendingUsage(workspaceId)).toBe(false);
    host.close();
    expect(() => admission.reserve({ method: "completeSimple", model: call.model })).toThrow("closed");
    expect(f.db.prepare("SELECT count(*) AS n FROM policy_calls").get()?.["n"]).toBe(0);
  });

  it("does not transfer native accounting binding through object or serialized copies", () => {
    const f = fixture(), host = HostModelAccounting.attach({ database: f.db, policy: f.policy });
    const admission = host.forWorkspace(workspaceId);
    for (const copied of [{ ...admission }, Object.create(admission), new Proxy(admission, {}), JSON.parse(JSON.stringify(admission))])
      expect(() => modelAccountingBinding(copied)).toThrow("cannot be copied or serialized");
    expect(modelAccountingBinding(admission)).toBeDefined();
    host.close();
    expect(() => modelAccountingBinding(admission)!.source.pending()).toThrow("closed");
  });

  it("rejects async policy hooks before invoking them", () => {
    let invoked = false;
    const f = fixture({ settle: async () => { invoked = true; } });
    expect(() => HostModelAccounting.attach({ database: f.db, policy: f.policy })).toThrow("must be synchronous");
    expect(invoked).toBe(false);
  });

  it("rolls back a synchronous hook returning a thenable before committing its reservation", () => {
    const f = fixture();
    f.policy.reserve = (id) => {
      f.db.prepare("INSERT INTO policy_calls VALUES('escaped')").run();
      return Promise.resolve({ id: "escaped", workspaceId: id }) as unknown as Reservation;
    };
    const host = HostModelAccounting.attach({ database: f.db, policy: f.policy });
    const call = modelUsageFixture();
    expect(() => host.forWorkspace(workspaceId).reserve({ method: "completeSimple", model: call.model })).toThrow("must be synchronous");
    expect(f.db.prepare("SELECT count(*) AS n FROM policy_calls").get()?.["n"]).toBe(0);
    expect(host.hasPendingPhysical()).toBe(false);
    host.close();
  });
});
