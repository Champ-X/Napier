import { execFile as execFileCallback, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import { afterEach, describe, expect, it } from "vitest";
import { ModelUsageReceiptSpool } from "../src/model-usage-source.js";
import { readVerifiedModelUsageDelivery } from "../src/model-usage-delivery.js";
import {
  createUndispatchedModelObservation,
  normalizeModelPhysicalObservation,
} from "../src/model-usage-observation.js";
import {
  modelUsageFixture,
  modelUsageUndispatchedProof,
} from "./model-usage-fixture.js";

const roots: string[] = [];
const execFile = promisify(execFileCallback);
const workerPath = fileURLToPath(
  new URL("./model-usage-source-worker.ts", import.meta.url),
);
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function filename() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-model-usage-"));
  roots.push(root);
  return path.join(root, "usage.sqlite");
}

describe("durable model usage source", () => {
  it("replays one immutable receipt after reopen, acknowledges only explicitly, and retains no output text", async () => {
    const file = await filename();
    let source = await ModelUsageReceiptSpool.open(file);
    const f = modelUsageFixture({
      sourceId: source.sourceId,
      hostWorkspaceId: "host-a",
    });
    const observation = normalizeModelPhysicalObservation({
      attribution: f.attribution,
      message: f.message,
      terminal: "response",
    });
    expect(source.reserve(f.attribution)).toBe("inserted");
    expect(source.reserve(f.attribution)).toBe("duplicate");
    expect(source.record(observation)).toBe("inserted");
    expect(source.record(observation)).toBe("duplicate");
    const delivery = source.pending({
      workspaceLedgerId: f.attribution.workspaceLedgerId,
    })[0]!;
    expect(readVerifiedModelUsageDelivery(delivery).observation).toEqual(
      observation,
    );
    expect(source.pending({ hostWorkspaceId: "another" })).toEqual([]);
    expect(
      source.pending({ physicalId: f.attribution.physicalId }),
    ).toHaveLength(1);
    source.close();
    expect(() => readVerifiedModelUsageDelivery(delivery)).toThrow("closed");
    source = await ModelUsageReceiptSpool.open(file);
    expect(source.sourceId).toBe(f.attribution.receiptSourceId);
    expect(source.pending()).toHaveLength(1);
    source.acknowledge(source.pending()[0]!);
    expect(source.pending()).toEqual([]);
    expect(source.record(observation)).toBe("duplicate");
    source.close();
    expect((await readFile(file)).toString("utf8")).not.toContain(
      "Private fixture response",
    );
  });

  it("participates in the caller's host transaction without nested commit", () => {
    const db = new DatabaseSync(":memory:"),
      source = ModelUsageReceiptSpool.attach(db);
    const f = modelUsageFixture({ sourceId: source.sourceId });
    const observation = normalizeModelPhysicalObservation({
      attribution: f.attribution,
      message: f.message,
      terminal: "response",
    });
    db.exec("CREATE TABLE host_debit(id TEXT PRIMARY KEY); BEGIN IMMEDIATE");
    source.reserve(f.attribution);
    source.record(observation);
    db.prepare("INSERT INTO host_debit VALUES(?)").run(
      f.attribution.physicalId,
    );
    expect(db.isTransaction).toBe(true);
    db.exec("ROLLBACK");
    expect(source.attribution(f.attribution.physicalId)).toBeUndefined();
    expect(source.pending()).toEqual([]);
    expect(
      db.prepare("SELECT count(*) AS amount FROM host_debit").get()?.["amount"],
    ).toBe(0);
    source.close();
    expect(db.prepare("SELECT 1 AS alive").get()?.["alive"]).toBe(1);
    db.close();
  });

  it("refuses forged delivery, another source, and every conflicting final observation", async () => {
    const left = await ModelUsageReceiptSpool.open(await filename()),
      right = await ModelUsageReceiptSpool.open(await filename());
    const f = modelUsageFixture({ sourceId: left.sourceId });
    expect(() => right.reserve(f.attribution)).toThrow("source differs");
    left.reserve(f.attribution);
    const unknown = normalizeModelPhysicalObservation({
      attribution: f.attribution,
      terminal: "rejected",
      observedAt: "2026-01-02T00:00:00.000Z",
    });
    left.record(unknown);
    const known = normalizeModelPhysicalObservation({
      attribution: f.attribution,
      message: f.message,
      terminal: "response",
    });
    expect(() => left.record(known)).toThrow("immutable");
    const delivery = left.pending()[0]!;
    expect(() =>
      readVerifiedModelUsageDelivery(structuredClone(delivery)),
    ).toThrow("authority");
    expect(() => right.acknowledge(delivery)).toThrow("source differs");
    expect(readVerifiedModelUsageDelivery(delivery).observation).toEqual(
      unknown,
    );
    left.close();
    right.close();
  });

  it("revalidates source bindings on every delivery read and detects replaced rows", () => {
    const db = new DatabaseSync(":memory:"),
      source = ModelUsageReceiptSpool.attach(db);
    const f = modelUsageFixture({ sourceId: source.sourceId });
    source.reserve(f.attribution);
    source.record(
      normalizeModelPhysicalObservation({
        attribution: f.attribution,
        message: f.message,
        terminal: "response",
      }),
    );
    const delivery = source.pending()[0]!;
    db.prepare(
      "UPDATE model_usage_receipts SET observation_json=? WHERE physical_id=?",
    ).run("{}", f.attribution.physicalId);
    expect(() => readVerifiedModelUsageDelivery(delivery)).toThrow();
    expect(() => source.acknowledge(delivery)).toThrow();
    source.close();
    db.close();
  });

  it("retains undispatched zero with original proof while empty reservations remain unresolved", async () => {
    const source = await ModelUsageReceiptSpool.open(await filename()),
      f = modelUsageFixture({ sourceId: source.sourceId });
    source.reserve(f.attribution);
    expect(source.pending()).toEqual([]);
    source.record(
      createUndispatchedModelObservation(
        f.attribution,
        modelUsageUndispatchedProof(f.attribution),
      ),
    );
    expect(
      readVerifiedModelUsageDelivery(source.pending()[0]!).observation
        .usageStatus,
    ).toBe("known_zero_undispatched");
    expect(source.attribution(f.attribution.physicalId)).toEqual(f.attribution);
    source.close();
  });

  it("requires private proof for new zero receipts but replays an exact persisted zero", async () => {
    const file = await filename();
    let source = await ModelUsageReceiptSpool.open(file);
    const f = modelUsageFixture({ sourceId: source.sourceId });
    source.reserve(f.attribution);
    const zero = createUndispatchedModelObservation(
      f.attribution,
      modelUsageUndispatchedProof(f.attribution),
    );
    const copy = JSON.parse(JSON.stringify(zero));
    expect(() => source.record(copy)).toThrow("proof authority");
    expect(() => source.record(structuredClone(zero))).toThrow(
      "proof authority",
    );
    expect(source.pending()).toEqual([]);
    source.record(zero);
    source.close();
    source = await ModelUsageReceiptSpool.open(file);
    expect(source.record(copy)).toBe("duplicate");
    source.acknowledge(source.pending()[0]!);
    source.close();
  });

  it("binds private zero authority to the original immutable receipt digest", () => {
    const db = new DatabaseSync(":memory:"),
      source = ModelUsageReceiptSpool.attach(db);
    const f = modelUsageFixture({ sourceId: source.sourceId });
    source.reserve(f.attribution);
    const zero = createUndispatchedModelObservation(
      f.attribution,
      modelUsageUndispatchedProof(f.attribution),
    );
    zero.observedAt = "2099-01-01T00:00:00.000Z";
    const { contentSha256: _old, ...content } = zero;
    zero.contentSha256 = sha256(canonicalJson(content));
    expect(() => source.record(zero)).toThrow("proof authority");
    expect(source.pending()).toEqual([]);
    source.close();
    db.close();
  });

  it.each([
    "UPDATE model_usage_source_meta SET source_id='replaced-source'",
    "UPDATE model_usage_reservations SET workspace_ledger_id='another-workspace'",
    "UPDATE model_usage_reservations SET host_workspace_id='another-host'",
    "UPDATE model_usage_receipts SET observation_sha256='corrupt-digest'",
    "DELETE FROM model_usage_receipts",
  ])(
    "rejects source mutation before reread, duplicate record, or acknowledgement: %s",
    (mutation) => {
      const db = new DatabaseSync(":memory:"),
        source = ModelUsageReceiptSpool.attach(db);
      const f = modelUsageFixture({
        sourceId: source.sourceId,
        hostWorkspaceId: "host-a",
      });
      source.reserve(f.attribution);
      const observation = normalizeModelPhysicalObservation({
        attribution: f.attribution,
        message: f.message,
        terminal: "response",
      });
      source.record(observation);
      const delivery = source.pending()[0]!;
      db.exec(mutation);
      expect(() => readVerifiedModelUsageDelivery(delivery)).toThrow();
      expect(() => source.acknowledge(delivery)).toThrow();
      if (!mutation.startsWith("DELETE"))
        expect(() => source.record(observation)).toThrow();
      source.close();
      db.close();
    },
  );

  it.each(["reserve_then_wait", "record_then_wait"])(
    "recovers actual SIGKILL after %s without redispatch",
    async (mode) => {
      const file = await filename(),
        root = path.dirname(file),
        input = path.join(root, "input.json"),
        ready = path.join(root, "ready");
      let source = await ModelUsageReceiptSpool.open(file);
      const f = modelUsageFixture({ sourceId: source.sourceId });
      const observation = normalizeModelPhysicalObservation({
        attribution: f.attribution,
        message: f.message,
        terminal: "response",
      });
      source.close();
      await writeFile(
        input,
        JSON.stringify({ attribution: f.attribution, observation }),
      );
      const child = spawn(
        process.execPath,
        ["--import", "tsx", workerPath, file, input, mode, ready],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      let errorOutput = "";
      child.stderr.on("data", (part) => {
        errorOutput += String(part);
      });
      try {
        const deadline = Date.now() + 15_000;
        for (;;) {
          if (await readFile(ready, "utf8").catch(() => "")) break;
          if (child.exitCode !== null || Date.now() >= deadline)
            throw new Error(
              `Usage child did not reach barrier: ${errorOutput}`,
            );
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        const exit = once(child, "exit");
        child.kill("SIGKILL");
        expect((await exit)[1]).toBe("SIGKILL");
        source = await ModelUsageReceiptSpool.open(file);
        expect(source.attribution(f.attribution.physicalId)).toEqual(
          f.attribution,
        );
        expect(source.pending()).toHaveLength(
          mode === "record_then_wait" ? 1 : 0,
        );
        if (mode === "record_then_wait") {
          const delivery = source.pending()[0]!;
          expect(readVerifiedModelUsageDelivery(delivery).observation).toEqual(
            observation,
          );
          source.acknowledge(delivery);
          expect(source.pending()).toEqual([]);
        }
        source.close();
      } finally {
        if (child.exitCode === null && child.signalCode === null)
          child.kill("SIGKILL");
      }
    },
    20_000,
  );

  it("deduplicates simultaneous writers in separate processes using SQLite", async () => {
    const file = await filename(),
      input = path.join(path.dirname(file), "input.json");
    let source = await ModelUsageReceiptSpool.open(file);
    const f = modelUsageFixture({ sourceId: source.sourceId });
    const observation = normalizeModelPhysicalObservation({
      attribution: f.attribution,
      message: f.message,
      terminal: "response",
      observedAt: "2026-01-02T00:00:00.000Z",
    });
    source.close();
    await writeFile(
      input,
      JSON.stringify({ attribution: f.attribution, observation }),
    );
    const results = await Promise.all(
      [0, 1].map(() =>
        execFile(
          process.execPath,
          ["--import", "tsx", workerPath, file, input, "record_once"],
          { timeout: 15_000 },
        ),
      ),
    );
    expect(
      results.map((result) => JSON.parse(result.stdout).recorded).sort(),
    ).toEqual(["duplicate", "inserted"]);
    source = await ModelUsageReceiptSpool.open(file);
    expect(source.pending()).toHaveLength(1);
    source.close();
  }, 20_000);
});
