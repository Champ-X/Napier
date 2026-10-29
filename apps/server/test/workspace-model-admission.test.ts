import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceModelAdmission } from "../src/workspace-model-admission.js";
import { modelCallAllowance, workspaceModelBudgetFromEnvironment, workspaceModelBudgetPolicy } from "../src/workspace-model-budget.js";
import { admissionModel, measuredMessage, workspaceA, workspaceB } from "./workspace-model-admission-fixture.js";

const homes: string[] = [];
const ledgers: WorkspaceModelAdmission[] = [];
async function home() { const directory = await mkdtemp(path.join(os.tmpdir(), "napier-model-admission-")); homes.push(directory); return directory; }
async function ledger(directory: string, options: Parameters<typeof WorkspaceModelAdmission.open>[1] = {}) {
  const result = await WorkspaceModelAdmission.open(directory, options); ledgers.push(result); return result;
}
afterEach(async () => {
  for (const entry of ledgers.splice(0)) entry.close();
  for (const directory of homes.splice(0)) await rm(directory, { recursive: true, force: true });
});
const request = () => ({ method: "streamSimple" as const, model: structuredClone(admissionModel) });

describe("shared durable model admission", () => {
  it("atomically shares capacity and usage across workspaces and independent connections", async () => {
    const directory = await home();
    const a = await ledger(directory, { maxConcurrent: 1 });
    const b = await ledger(directory, { maxConcurrent: 4 });
    const call = a.forWorkspace(workspaceA).reserve(request());
    expect(a.hasPending(workspaceA)).toBe(true);
    expect(a.hasPending(workspaceB)).toBe(false);
    expect(() => b.forWorkspace(workspaceB).reserve(request())).toThrow(expect.objectContaining({ code: "capacity" }));
    const result = measuredMessage();
    const original = structuredClone(result);
    call.settle(result); call.settle(result);
    expect(result).toEqual(original);
    expect(b.snapshot()).toMatchObject({ effectiveMaxConcurrent: 1, activeInvocations: 0, budgetInvocations: 1, chargedTokens: 14 });
    expect(b.snapshot().chargedCostUsd).toBeCloseTo(0.000018, 9);
    a.close();
    const second = b.forWorkspace(workspaceB).reserve(request());
    expect(b.snapshot().effectiveMaxConcurrent).toBe(4);
    second.settle(measuredMessage()); b.close();
    const reopened = await ledger(directory);
    expect(reopened.snapshot()).toMatchObject({ budgetInvocations: 2, chargedTokens: 28, activeInvocations: 0 });
  });

  it("retains the full allowance after uncertain errors and across reopening", async () => {
    const directory = await home();
    const a = await ledger(directory, { maxTokens: 120 });
    const call = a.forWorkspace(workspaceA).reserve(request());
    const drain = a.drainWorkspace(workspaceA);
    call.settle({ ...measuredMessage(), stopReason: "aborted" }); await drain;
    expect(a.snapshot()).toMatchObject({ uncertainInvocations: 1, chargedTokens: 120, activeInvocations: 0, observedTokens: 14 });
    expect(() => a.forWorkspace(workspaceB).reserve(request())).toThrow(expect.objectContaining({ code: "budget" }));
    a.close();
    const reopened = await ledger(directory, { maxTokens: 120 });
    expect(() => reopened.forWorkspace(workspaceA).reserve(request())).toThrow(expect.objectContaining({ code: "budget" }));
  });

  it("never refunds invocation allowance and rejects silent budget policy changes", async () => {
    const directory = await home();
    const a = await ledger(directory, { maxInvocations: 1 });
    a.forWorkspace(workspaceA).reserve(request()).settle(measuredMessage());
    expect(() => a.forWorkspace(workspaceB).reserve(request())).toThrow(expect.objectContaining({ code: "budget" }));
    await expect(ledger(directory, { maxInvocations: 2 })).rejects.toThrow("policy changed");
    const renewed = await ledger(directory, { epoch: "explicit-renewal", maxInvocations: 2 });
    expect(renewed.snapshot().budgetInvocations).toBe(0);
    renewed.forWorkspace(workspaceB).reserve(request()).settle(measuredMessage());
    expect(a.snapshot().budgetInvocations).toBe(1);
  });

  it("requires a known tariff for finite USD allowances and an explicit declaration for free models", async () => {
    const directory = await home();
    const unknown = { ...admissionModel, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
    const a = await ledger(directory, { maxCostUsd: 1 });
    expect(() => a.forWorkspace(workspaceA).reserve({ method: "complete", model: unknown })).toThrow(expect.objectContaining({ code: "budget" }));
    expect(a.snapshot().budgetInvocations).toBe(0);
    const free = await ledger(directory, { epoch: "declared-free", maxCostUsd: 0, zeroCostModels: ["fixture/local-model"] });
    const call = free.forWorkspace(workspaceA).reserve({ method: "complete", model: unknown });
    const message = measuredMessage(); message.usage.cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
    call.settle(message);
    expect(free.snapshot()).toMatchObject({ chargedCostUsd: 0, uncertainInvocations: 0, chargedTokens: 14 });
  });

  it("reserves a conservative tier/long-cache envelope and freezes prices before dispatch", async () => {
    const a = await ledger(await home(), { maxCostUsd: 1 });
    const input = request();
    input.model.cost.tiers = [{ inputTokensAbove: 5, input: 3, output: 6, cacheRead: 2, cacheWrite: 4 }];
    const allowance = modelCallAllowance(input.model, undefined, workspaceModelBudgetPolicy());
    expect(allowance.costNanos).toBe(1_220_000); // 100 * (3+2+6) + 20*6 per million.
    const call = a.forWorkspace(workspaceA).reserve(input);
    input.model.cost.tiers[0]!.input = 999;
    call.settle(measuredMessage());
    expect(a.snapshot().chargedCostUsd).toBeCloseTo(0.000054, 9);
  });

  it("records overruns as debt and treats missing or zero usage as uncertain", async () => {
    const directory = await home();
    const a = await ledger(directory, { maxCostUsd: 0.001 });
    const call = a.forWorkspace(workspaceA).reserve(request());
    const message = measuredMessage(); message.usage.cost.total = 0.01;
    call.settle(message);
    expect(a.snapshot().chargedCostUsd).toBe(0.01);
    expect(() => a.forWorkspace(workspaceB).reserve(request())).toThrow(expect.objectContaining({ code: "budget" }));
    const zero = await ledger(directory, { epoch: "zero-observation" });
    const zeroCall = zero.forWorkspace(workspaceA).reserve(request());
    const empty = measuredMessage(); empty.usage.input = 0; empty.usage.output = 0; empty.usage.totalTokens = 0;
    zeroCall.settle(empty);
    expect(zero.snapshot()).toMatchObject({ chargedTokens: 120, uncertainInvocations: 1 });
    const missing = measuredMessage();
    delete (missing.usage as Partial<typeof missing.usage>).cost;
    zero.forWorkspace(workspaceA).reserve(request()).settle(missing);
    expect(zero.snapshot()).toMatchObject({ activeInvocations: 0, uncertainInvocations: 2, chargedTokens: 240 });
  });

  it("quarantines accounting failures without freeing live capacity or closing the ledger", async () => {
    const directory = await home();
    const a = await ledger(directory, { maxConcurrent: 1 });
    const call = a.forWorkspace(workspaceA).reserve(request());
    const db = new DatabaseSync(path.join(directory, "model-admission.sqlite"));
    try {
      db.exec("CREATE TRIGGER fail_settlement BEFORE UPDATE ON model_invocations BEGIN SELECT RAISE(ABORT, 'storage failure'); END");
      expect(() => call.settle(measuredMessage())).toThrow("storage failure");
      expect(a.hasPending(workspaceA)).toBe(true);
      await expect(a.drainWorkspace(workspaceA)).rejects.toMatchObject({ code: "accounting" });
      expect(() => a.close()).toThrow(expect.objectContaining({ code: "accounting" }));
      expect(() => a.forWorkspace(workspaceB).reserve(request())).toThrow(expect.objectContaining({ code: "capacity" }));
    } finally {
      db.exec("DROP TRIGGER fail_settlement"); db.close();
      call.settle(measuredMessage());
    }
  });

  it("retains higher partial observations even when usage counters disagree", async () => {
    const a = await ledger(await home(), { maxTokens: 1_000, maxCostUsd: 1 });
    const call = a.forWorkspace(workspaceA).reserve(request());
    const partial = measuredMessage(); partial.usage.totalTokens = 2_000; partial.usage.cost.total = 2;
    call.settle(partial);
    expect(a.snapshot()).toMatchObject({ chargedTokens: 2_000, chargedCostUsd: 2, uncertainInvocations: 1 });
    expect(() => a.forWorkspace(workspaceB).reserve(request())).toThrow(expect.objectContaining({ code: "budget" }));
  });

  it("retains valid component overruns when another token counter is missing", async () => {
    const a = await ledger(await home(), { maxTokens: 1_000 });
    const partial = measuredMessage(); partial.usage.input = 2_000;
    delete (partial.usage as Partial<typeof partial.usage>).output;
    a.forWorkspace(workspaceA).reserve(request()).settle(partial);
    expect(a.snapshot()).toMatchObject({ chargedTokens: 2_000, uncertainInvocations: 1, observedTokens: 2_000 });
    expect(a.snapshot().chargedCostUsd).toBeCloseTo(0.002, 9);
    expect(() => a.forWorkspace(workspaceB).reserve(request())).toThrow(expect.objectContaining({ code: "budget" }));
  });

  it("records frozen tariff debt even when the provider omits cost reporting", async () => {
    const a = await ledger(await home(), { maxCostUsd: 1 });
    const partial = measuredMessage(); partial.usage.input = 2_000_000; partial.usage.totalTokens = 2_000_004;
    delete (partial.usage as Partial<typeof partial.usage>).cost;
    a.forWorkspace(workspaceA).reserve(request()).settle(partial);
    expect(a.snapshot()).toMatchObject({ chargedTokens: 2_000_004, uncertainInvocations: 1 });
    expect(a.snapshot().chargedCostUsd).toBeCloseTo(2.000008, 9);
    expect(() => a.forWorkspace(workspaceB).reserve(request())).toThrow(expect.objectContaining({ code: "budget" }));
  });

  it("retains long-cache and cost-component observations despite missing aggregate counters", async () => {
    const a = await ledger(await home(), { maxTokens: 1_000 });
    const partial = measuredMessage();
    const usage = partial.usage as Partial<typeof partial.usage> & { cacheWrite1h?: number };
    usage.cacheWrite1h = 2_000; delete usage.cacheWrite;
    a.forWorkspace(workspaceA).reserve(request()).settle(partial);
    expect(a.snapshot()).toMatchObject({ chargedTokens: 2_014, uncertainInvocations: 1 });
    expect(a.snapshot().chargedCostUsd).toBeCloseTo(0.004018, 9);
    const b = await ledger(await home(), { maxCostUsd: 1 });
    const costs = measuredMessage(); costs.usage.cost.output = 2;
    delete (costs.usage.cost as Partial<typeof costs.usage.cost>).total;
    b.forWorkspace(workspaceB).reserve(request()).settle(costs);
    expect(b.snapshot()).toMatchObject({ uncertainInvocations: 1 });
    expect(b.snapshot().chargedCostUsd).toBeCloseTo(2.00001, 9);
    expect(() => b.forWorkspace(workspaceB).reserve(request())).toThrow(expect.objectContaining({ code: "budget" }));
  });

  it("charges unclassified excess total tokens at the highest frozen tariff", async () => {
    const a = await ledger(await home(), { maxCostUsd: 0.001 });
    const partial = measuredMessage(); partial.usage.totalTokens = 2_000;
    a.forWorkspace(workspaceA).reserve(request()).settle(partial);
    expect(a.snapshot()).toMatchObject({ chargedTokens: 2_000, uncertainInvocations: 1 });
    expect(a.snapshot().chargedCostUsd).toBeCloseTo(0.00399, 9);
    expect(() => a.forWorkspace(workspaceB).reserve(request())).toThrow(expect.objectContaining({ code: "budget" }));
  });

  it("retains reasoning output when aggregate output is missing without double-counting complete usage", async () => {
    const a = await ledger(await home(), { maxCostUsd: 0.001 });
    const partial = measuredMessage();
    const usage = partial.usage as Partial<typeof partial.usage> & { reasoning?: number };
    usage.reasoning = 2_000; delete usage.output;
    a.forWorkspace(workspaceA).reserve(request()).settle(partial);
    expect(a.snapshot()).toMatchObject({ chargedTokens: 2_010, uncertainInvocations: 1 });
    expect(a.snapshot().chargedCostUsd).toBeCloseTo(0.00401, 9);
    expect(() => a.forWorkspace(workspaceB).reserve(request())).toThrow(expect.objectContaining({ code: "budget" }));
    const b = await ledger(await home());
    const complete = measuredMessage();
    (complete.usage as typeof complete.usage & { reasoning?: number }).reasoning = 3;
    b.forWorkspace(workspaceB).reserve(request()).settle(complete);
    expect(b.snapshot()).toMatchObject({ chargedTokens: 14, uncertainInvocations: 0 });
  });

  it("releases only dead-owner capacity after SIGKILL, retaining its durable budget debit", async () => {
    const directory = await home();
    const child = fork(fileURLToPath(new URL("./workspace-model-admission-owner-fixture.ts", import.meta.url)), [directory],
      { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"] });
    let errors = ""; child.stderr?.on("data", (chunk) => { errors += String(chunk); });
    const exited = once(child, "exit");
    try {
      const message = await Promise.race([once(child, "message"), exited.then(() => { throw new Error(errors); })]);
      expect(message[0]).toMatchObject({ reserved: true, snapshot: { activeInvocations: 1 } });
      const a = await ledger(directory, { maxConcurrent: 1, maxInvocations: 1 });
      expect(() => a.forWorkspace(workspaceB).reserve(request())).toThrow(expect.objectContaining({ code: "capacity" }));
      child.kill("SIGKILL"); expect((await exited)[1]).toBe("SIGKILL");
      expect(a.snapshot()).toMatchObject({ activeInvocations: 0, uncertainInvocations: 1, budgetInvocations: 1, chargedTokens: 120 });
      expect(() => a.forWorkspace(workspaceB).reserve(request())).toThrow(expect.objectContaining({ code: "budget" }));
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await exited;
    }
  }, 15_000);

  it("validates configuration and aborts before allocating a durable invocation", async () => {
    expect(() => workspaceModelBudgetFromEnvironment({ NAPIER_MODEL_MAX_CONCURRENT: "NaN" })).toThrow();
    expect(() => workspaceModelBudgetFromEnvironment({ NAPIER_MODEL_BUDGET_TOKENS: " " })).toThrow();
    expect(workspaceModelBudgetFromEnvironment({ NAPIER_MODEL_BUDGET_INVOCATIONS: "0" })).toEqual({ maxInvocations: 0 });
    const a = await ledger(await home());
    expect(() => a.forWorkspace(workspaceA).reserve({ ...request(), options: { signal: AbortSignal.abort() } })).toThrow();
    expect(a.snapshot().budgetInvocations).toBe(0);
  });
});
