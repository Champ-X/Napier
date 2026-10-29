import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { chmod, link, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceResourceAdmission } from "../src/workspace-resource-admission.js";

const directories: string[] = [];
interface RecoveryHost {
  process: ReturnType<typeof fork>;
  exit: ReturnType<typeof once>;
  ready: Promise<{ id: string; pid: number; executionClosed: boolean; snapshot?: { occupied: number } }>;
  stop(): Promise<void>;
}
const hosts: RecoveryHost[] = [];
const ledgers: WorkspaceResourceAdmission[] = [];
async function home() {
  const value = await mkdtemp(path.join(os.tmpdir(), "napier-resource-recovery-"));
  directories.push(value);
  return value;
}
async function open(directory: string) {
  const value = await WorkspaceResourceAdmission.open(directory, { sandbox_execution: 1 });
  ledgers.push(value);
  return value;
}
function database(directory: string) { return new DatabaseSync(path.join(directory, "execution-resources.sqlite")); }
function allowRelease(directory: string) {
  const db = database(directory);
  try { db.exec("DROP TRIGGER reject_recovery_release"); } finally { db.close(); }
}
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.stop();
  for (const ledger of ledgers.splice(0)) ledger.close();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe("completed execution resource receipt recovery", () => {
  it("persists its immutable nonce-bound ticket in the reservation transaction before dispatch", async () => {
    const directory = await home();
    const owner = startHost(directory, "reserved");
    const ready = await owner.ready;
    const db = database(directory);
    try {
      const row = db.prepare("SELECT r.state,t.ticket_json FROM execution_resources r JOIN resource_recovery_tickets t ON t.resource_id=r.id WHERE r.id=?").get(ready.id)!;
      expect(row["state"]).toBe("reserved");
      expect(JSON.parse(String(row["ticket_json"]))).toMatchObject({ leaseId: ready.id, ownerPid: ready.pid,
        kind: "sandbox_execution", backend: "fixture", protocol: "owner-complete-v1", nonce: expect.stringMatching(/^[a-f0-9]{48}$/u) });
      expect(await readdir(path.join(directory, "execution-resource-receipts"))).toEqual([]);
    } finally { db.close(); }
  });

  it("recovers completed cleanup after the real owner dies before SQLite settlement", async () => {
    const directory = await home();
    const owner = startHost(directory, "settlement_failed");
    const ready = await owner.ready;
    expect(ready).toMatchObject({ executionClosed: true });
    const receiptRoot = path.join(directory, "execution-resource-receipts");
    const receiptPath = path.join(receiptRoot, `${ready.id}.json`);
    expect((await stat(receiptRoot)).mode & 0o777).toBe(0o700);
    expect((await stat(receiptPath)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(receiptPath, "utf8"))).toMatchObject({
      leaseId: ready.id, completionScope: "entire-admitted-resource", cleanup: { status: "released" },
    });
    await owner.stop();
    allowRelease(directory);
    const recovered = await open(directory);
    expect(recovered.snapshot()[0]).toMatchObject({ occupied: 0, quarantined: 0 });
    recovered.close();
    expect((await open(directory)).snapshot()[0]?.occupied).toBe(0);
  });

  it.each(["browser_session", "browser_task"])("binds completion recovery to the declared %s capacity unit", async (kind) => {
    const directory = await home();
    const owner = startHost(directory, "settlement_failed", kind);
    await owner.ready;
    await owner.stop();
    allowRelease(directory);
    expect((await open(directory)).snapshot().find((entry) => entry.kind === kind)?.occupied).toBe(0);
    const db = database(directory);
    try { expect(JSON.parse(String(db.prepare("SELECT cleanup_json FROM execution_resources").get()?.["cleanup_json"]))).toMatchObject({ scope: kind, status: "released" }); }
    finally { db.close(); }
  });

  it("does not consume a completed receipt while its original owner is alive", async () => {
    const directory = await home();
    const owner = startHost(directory, "settlement_failed");
    await owner.ready;
    allowRelease(directory);
    expect((await open(directory)).snapshot()[0]).toMatchObject({ occupied: 1, active: 1 });
    await owner.stop();
    expect((await open(directory)).snapshot()[0]?.occupied).toBe(0);
  });

  it.each(["active", "unknown"])("retains %s ownership without a complete cleanup receipt", async (mode) => {
    const directory = await home();
    const owner = startHost(directory, mode);
    await owner.ready;
    await owner.stop();
    expect((await open(directory)).snapshot()[0]).toMatchObject({ occupied: 1, quarantined: 1 });
    expect(await readdir(path.join(directory, "execution-resource-receipts"))).toEqual([]);
  });

  it("does not infer owner death from a missing host registration", async () => {
    const directory = await home();
    const owner = startHost(directory, "settlement_failed");
    await owner.ready;
    allowRelease(directory);
    const db = database(directory);
    try { db.exec("DELETE FROM resource_hosts"); } finally { db.close(); }
    expect((await open(directory)).snapshot()[0]?.occupied).toBe(1);
    await owner.stop();
    expect((await open(directory)).snapshot()[0]?.occupied).toBe(0);
  });

  it.each(["missing", "truncated", "invalid_utf8", "nonce", "scope", "identity", "unknown", "component", "extra_field", "duplicate_field", "public", "symlink", "hardlink", "legacy"])("retains capacity for %s completion evidence", async (damage) => {
    const directory = await home();
    const owner = startHost(directory, "settlement_failed");
    const { id } = await owner.ready;
    await owner.stop();
    allowRelease(directory);
    const filename = path.join(directory, "execution-resource-receipts", `${id}.json`);
    const text = await readFile(filename, "utf8");
    const receipt = JSON.parse(text) as Record<string, unknown>;
    if (damage === "missing") await rm(filename);
    else if (damage === "truncated") await writeFile(filename, text.slice(0, 20));
    else if (damage === "invalid_utf8") {
      // U+FFFD is a valid resource ID; replacing its bytes with malformed UTF-8
      // must not be normalized back into that valid identity during verification.
      const identity = { resourceId: "fixture-\ufffd" };
      const db = database(directory);
      try { db.prepare("UPDATE execution_resources SET identity_json=? WHERE id=?").run(JSON.stringify(identity), id); }
      finally { db.close(); }
      receipt["resourceIdentity"] = identity;
      delete receipt["contentSha256"];
      receipt["contentSha256"] = hash(JSON.stringify(receipt));
      const normalized = Buffer.from(JSON.stringify(receipt));
      const offset = normalized.indexOf(Buffer.from("\ufffd"));
      await writeFile(filename, Buffer.concat([normalized.subarray(0, offset), Buffer.from([0xff]), normalized.subarray(offset + 3)]));
    }
    else if (damage === "public") await chmod(filename, 0o644);
    else if (damage === "symlink") {
      await rename(filename, `${filename}.original`);
      await symlink(`${filename}.original`, filename);
    } else if (damage === "hardlink") await link(filename, `${filename}.copy`);
    else if (damage === "legacy") {
      const db = database(directory);
      try { db.prepare("DELETE FROM resource_recovery_tickets WHERE resource_id=?").run(id); } finally { db.close(); }
    } else if (damage === "component") {
      await writeFile(filename, JSON.stringify({ type: "exit", nonce: receipt["nonce"], cleanup: receipt["cleanup"] }));
    } else if (damage === "duplicate_field") {
      await writeFile(filename, text.replace('"schemaVersion":1,', '"schemaVersion":1,"schemaVersion":1,'));
    } else {
      const cleanup = receipt["cleanup"] as Record<string, unknown>;
      if (damage === "nonce") receipt["nonce"] = "0".repeat(48);
      if (damage === "scope") cleanup["scope"] = "browser_task";
      if (damage === "identity") receipt["resourceIdentity"] = { resourceId: "another-resource" };
      if (damage === "unknown") cleanup["status"] = "unknown";
      if (damage === "extra_field") receipt["claimsComplete"] = true;
      delete receipt["contentSha256"];
      receipt["contentSha256"] = hash(JSON.stringify(receipt));
      await writeFile(filename, JSON.stringify(receipt));
    }
    expect((await open(directory)).snapshot()[0]).toMatchObject({ occupied: 1, quarantined: 1 });
  });

  it("commits one recovery when two independent hosts ingest the same receipt", async () => {
    const directory = await home();
    const owner = startHost(directory, "settlement_failed");
    await owner.ready;
    await owner.stop();
    allowRelease(directory);
    const db = database(directory);
    try {
      db.exec("CREATE TABLE recovered_once(resource_id TEXT); CREATE TRIGGER count_recovery AFTER UPDATE ON execution_resources WHEN NEW.state='released' AND OLD.state!='released' BEGIN INSERT INTO recovered_once VALUES(NEW.id); END");
      const contenders = [startHost(directory, "recover"), startHost(directory, "recover")];
      expect((await Promise.all(contenders.map((host) => host.ready))).map((entry) => entry.snapshot?.occupied)).toEqual([0, 0]);
      expect(db.prepare("SELECT count(*) AS amount FROM recovered_once").get()?.["amount"]).toBe(1);
      expect(db.prepare("SELECT receipt_sha256,recovered_at FROM resource_recovery_tickets").get()).toMatchObject({
        receipt_sha256: expect.stringMatching(/^[a-f0-9]{64}$/u), recovered_at: expect.any(String),
      });
    } finally { db.close(); }
  });

  it("retains evidence after a recovery transaction failure and retries after the fault is removed", async () => {
    const directory = await home();
    const owner = startHost(directory, "settlement_failed");
    await owner.ready;
    await owner.stop();
    await expect(open(directory)).rejects.toThrow("injected release failure");
    const db = database(directory);
    try {
      expect(db.prepare("SELECT state FROM execution_resources").get()?.["state"]).toBe("quarantined");
      expect(db.prepare("SELECT receipt_sha256 FROM resource_recovery_tickets").get()?.["receipt_sha256"]).toBeNull();
      expect(db.prepare("SELECT count(*) AS amount FROM resource_hosts").get()?.["amount"]).toBe(0);
    } finally { db.close(); }
    allowRelease(directory);
    expect((await open(directory)).snapshot()[0]?.occupied).toBe(0);
  });

  it("finishes a bounded startup sweep past missing proof without requiring another host restart", async () => {
    const directory = await home();
    const owner = startHost(directory, "settlement_failed");
    const { id } = await owner.ready;
    await owner.stop();
    allowRelease(directory);
    seedMalformedTickets(directory, id, 128);
    const observer = await open(directory);
    expect(observer.snapshot()[0]?.occupied).toBe(128);
    observer.close();
    const restarted = await open(directory);
    expect(restarted.snapshot()[0]?.occupied).toBe(128);
    expect(restarted.reconcileCompletedReceipts()).toEqual({ examined: 128, released: 0, skipped: 128, hasMore: false });
  });

  it("retains oversized polluted cohorts beyond the startup bound while allowing explicit continuation", async () => {
    const directory = await home();
    const owner = startHost(directory, "settlement_failed");
    const { id } = await owner.ready;
    await owner.stop();
    allowRelease(directory);
    seedMalformedTickets(directory, id, 768);
    const observer = await open(directory);
    expect(observer.snapshot()[0]?.occupied).toBe(769);
    expect(observer.reconcileCompletedReceipts()).toEqual({ examined: 1, released: 1, skipped: 0, hasMore: false });
    expect(observer.snapshot()[0]?.occupied).toBe(768);
  });

  it("retains the live lease when receipt publication encounters a symlink and retries without overwriting its target", async () => {
    const directory = await home();
    const owner = await open(directory);
    const lease = owner.forWorkspace(`workspace_${"d".repeat(64)}`).reserve({ kind: "sandbox_execution", backend: "fixture" });
    lease.dispatched();
    const receipt = path.join(directory, "execution-resource-receipts", `${lease.id}.json`);
    const decoy = path.join(directory, "untouched.json");
    await writeFile(decoy, "preserved", { mode: 0o600 });
    await symlink(decoy, receipt);
    const cleanup = { status: "released", scope: "sandbox_execution", reason: "fixture_complete_cleanup" } as const;
    try {
      expect(() => lease.settle(cleanup)).toThrow();
      expect(owner.hasPending(`workspace_${"d".repeat(64)}`)).toBe(true);
      expect(owner.snapshot()[0]?.occupied).toBe(1);
      expect(await readFile(decoy, "utf8")).toBe("preserved");
    } finally { await rm(receipt); lease.settle(cleanup); }
    expect(owner.snapshot()[0]?.occupied).toBe(0);
    const db = database(directory);
    try { expect(db.prepare("SELECT pending,receipt_sha256 FROM resource_recovery_tickets WHERE resource_id=?").get(lease.id))
      .toMatchObject({ pending: 0, receipt_sha256: expect.stringMatching(/^[a-f0-9]{64}$/u) }); }
    finally { db.close(); }
  });
});

function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }

function seedMalformedTickets(directory: string, id: string, count: number) {
  const db = database(directory);
  try {
    db.exec("BEGIN IMMEDIATE");
    for (let index = 0; index < count; index += 1) {
      const invalidId = `!invalid-${String(index).padStart(3, "0")}`;
      db.prepare(`INSERT INTO execution_resources SELECT ?,owner_id,workspace_id,kind,backend,state,identity_json,cleanup_json,created_at,updated_at
        FROM execution_resources WHERE id=?`).run(invalidId, id);
      db.prepare("INSERT INTO resource_recovery_tickets(resource_id,ticket_json) VALUES(?,'{}')").run(invalidId);
    }
    db.exec("COMMIT");
  } finally { db.close(); }
}

function startHost(directory: string, mode: string, kind = "sandbox_execution"): RecoveryHost {
  const filename = fileURLToPath(new URL("./workspace-resource-recovery-process.ts", import.meta.url));
  const child = fork(filename, [directory, mode, kind], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"] });
  let errors = "";
  child.stderr?.on("data", (chunk) => { errors += String(chunk); });
  const exit = once(child, "exit");
  const ready = Promise.race([
    once(child, "message").then(([message]) => message as { id: string; pid: number; executionClosed: boolean; snapshot?: { occupied: number } }),
    exit.then(() => { throw new Error(`Recovery host exited before ready: ${errors}`); }),
  ]);
  const host = {
    process: child, exit, ready,
    async stop() {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await exit;
    },
  };
  hosts.push(host);
  return host;
}
