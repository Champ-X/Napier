import { fork } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LocalStore } from "@napier/runtime/store";
import type { AutomaticRecoveryAssessment, AutomaticRecoveryAttempt, BootstrapResponse, RunRecord, ThreadDetail, WorkspaceSummary } from "@napier/contracts";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceRuntimeCatalog } from "../src/workspace-runtime-catalog.js";
import { resolveWorkspaceRuntimeIdentity } from "../src/workspace-runtime-identity.js";

interface WorkspaceObservation {
  workspaceId: string;
  restoredWorkspace: WorkspaceSummary;
  priorRun: RunRecord;
  runs: RunRecord[];
  assessments: AutomaticRecoveryAssessment[];
  attempts: AutomaticRecoveryAttempt[];
}

describe("multi-workspace execution after process death", () => {
  it("recovers A and B exactly once in their original ledgers and retains C's manual policy", async () => {
    const startedAt = performance.now();
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "napier-workspace-recovery-")));
    const stateHome = path.join(directory, "host-state");
    const identities = await Promise.all(["a", "b", "c"].map(async (label) => {
      const root = path.join(directory, label); await mkdir(root);
      return resolveWorkspaceRuntimeIdentity(root, path.join(directory, `custom-data-${label}`));
    }));
    const a = identities[0]!;
    const catalog = await WorkspaceRuntimeCatalog.open(stateHome);
    for (const identity of identities) catalog.register(identity);
    catalog.close();
    const seed = new LocalStore({ workspaceRoot: a.root, dataRoot: a.dataRoot });
    await seed.initialize();
    const agent = await seed.updateAgent(seed.listAgents()[0]!.id, {
      model: { provider: "faux-workspace-recovery", id: "faux-1" }, enabledTools: [], enabledSubagents: [],
      automaticRecovery: { mode: "safe_read_only", maxAttempts: 3, backoffMs: 1_000 },
    });
    const thread = await seed.createThread({ title: "Copied thread, independent recovery", agentId: agent.id });
    await seed.shutdown();
    for (const identity of identities.slice(1)) await cp(a.dataRoot, identity.dataRoot, { recursive: true });
    const c = identities[2]!;
    const manual = new LocalStore({ workspaceRoot: c.root, dataRoot: c.dataRoot });
    await manual.initialize();
    await manual.updateAgent(agent.id, { automaticRecovery: { mode: "manual", maxAttempts: 3, backoffMs: 1_000 } });
    await manual.shutdown();

    const processes: ReturnType<typeof launch>[] = [];
    const streams: Promise<unknown>[] = [];
    const priorRuns = new Map<string, RunRecord>();
    const restoredWorkspaces = new Map<string, WorkspaceSummary>();
    const observations: WorkspaceObservation[] = [];
    try {
      const original = launch(stateHome, a.root, "hold"); processes.push(original);
      const firstOrigin = await original.origin();
      for (const identity of identities) {
        streams.push(fetch(endpoint(firstOrigin, identity.workspaceId, `threads/${thread.id}/messages`), {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: "Finish only in this workspace.", model: agent.model }),
        }).then((response) => response.text()).catch(() => undefined));
      }
      await vi.waitFor(() => expect(original.messages.filter((message) => message.type === "held")).toHaveLength(3), { timeout: 15_000 });
      const originalIds = new Map(original.messages.filter((message) => message.type === "held").map((message) => [message.root, message.runId]));
      for (const identity of identities) {
        const detail = await detailAt(firstOrigin, identity.workspaceId, thread.id);
        expect(detail.runs).toHaveLength(1);
        expect(detail.runs[0]).toMatchObject({ id: originalIds.get(identity.root), status: "running" });
        expect(detail.events.filter((event) => event.type === "run.started")).toHaveLength(1);
        expect(detail.events.some((event) => event.type === "tool.started")).toBe(false);
        priorRuns.set(identity.workspaceId, detail.runs[0]!);
      }
      const killedAt = performance.now();
      original.child.kill("SIGKILL");
      expect((await original.exited)[1]).toBe("SIGKILL");
      await Promise.all(streams);

      const restarted = launch(stateHome, a.root, "recover"); processes.push(restarted);
      const origin = await restarted.origin();
      await vi.waitFor(async () => {
        for (const identity of identities.slice(0, 2)) {
          const detail = await detailAt(origin, identity.workspaceId, thread.id);
          expect(detail.runs).toHaveLength(2);
          expect(detail.runs.find((run) => run.source === "recovery")).toMatchObject({
            status: "completed", parentRunId: originalIds.get(identity.root),
          });
        }
      }, { timeout: 15_000, interval: 100 });
      const killToRecoveryMs = Math.round(performance.now() - killedAt);
      restarted.child.send("shutdown");
      expect((await restarted.exited)[0]).toBe(0);

      // A second independent host startup must not create duplicate continuations.
      const reopened = launch(stateHome, a.root, "recover"); processes.push(reopened);
      const finalOrigin = await reopened.origin();
      for (const identity of identities) {
        const bootstrap = await bootstrapAt(finalOrigin, identity.workspaceId, thread.id);
        expect(bootstrap.workspace).toMatchObject({ root: identity.root, dataRoot: identity.dataRoot });
        restoredWorkspaces.set(identity.workspaceId, bootstrap.workspace);
        const detail = await detailAt(finalOrigin, identity.workspaceId, thread.id);
        expect(detail.runs.find((run) => run.id === originalIds.get(identity.root))?.status).toBe("interrupted");
        if (identity === c) {
          expect(detail.runs).toHaveLength(1);
        } else {
          expect(detail.runs).toHaveLength(2);
          const answer = (detail.messages ?? []).filter((message) => message.role === "assistant").map((message) => message.text).join("\n");
          expect(answer).toContain(`Recovered only in workspace ${path.basename(identity.root)}.`);
          expect(answer).not.toContain(`workspace ${identity === a ? "b" : "a"}.`);
        }
      }
      reopened.child.send("shutdown"); expect((await reopened.exited)[0]).toBe(0);
      for (const identity of identities) {
        const store = new LocalStore({ workspaceRoot: identity.root, dataRoot: identity.dataRoot });
        await store.initialize();
        try {
          const attempts = store.listAutomaticRecoveryAttempts();
          const assessments = store.listAutomaticRecoveryAssessments();
          if (identity === c) {
            expect(attempts).toHaveLength(0);
            expect(assessments[0]?.blockReasons).toContain("policy_manual");
          } else {
            expect(attempts).toHaveLength(1);
            expect(attempts[0]?.status).toBe("completed");
          }
          observations.push({
            workspaceId: identity.workspaceId,
            restoredWorkspace: restoredWorkspaces.get(identity.workspaceId)!,
            priorRun: priorRuns.get(identity.workspaceId)!,
            runs: store.listRuns(thread.id), assessments, attempts,
          });
        } finally { await store.shutdown(); }
      }
      expect(new Set(processes.map((entry) => entry.child.pid)).size).toBe(3);
      const output = process.env["NAPIER_WORKSPACE_RECOVERY_OBSERVATIONS"];
      if (output) await writeFile(output, JSON.stringify({
        copiedThreadId: thread.id,
        fault: { signal: original.child.signalCode, checkpoint: "persisted run.started before model dispatch" },
        processes: processes.map((entry) => ({ pid: entry.child.pid, exitCode: entry.child.exitCode, signal: entry.child.signalCode })),
        timing: { killToRecoveryMs, totalMs: Math.round(performance.now() - startedAt) },
        observations,
      }, null, 2) + "\n", { flag: "wx" });
    } finally {
      for (const process of processes) {
        if (process.child.exitCode === null && process.child.signalCode === null) process.child.kill("SIGKILL");
        await process.exited;
      }
      await Promise.all(streams);
      await rm(directory, { recursive: true, force: true });
    }
  }, 45_000);
});

function endpoint(origin: string, workspaceId: string, resource: string) {
  return `${origin}/api/workspaces/${workspaceId}/${resource}`;
}

async function detailAt(origin: string, workspaceId: string, threadId: string): Promise<ThreadDetail> {
  const response = await fetch(endpoint(origin, workspaceId, `threads/${threadId}`), { signal: AbortSignal.timeout(10_000) });
  expect(response.status).toBe(200);
  expect(response.headers.get("X-Napier-Workspace-Id")).toBe(workspaceId);
  return response.json();
}

async function bootstrapAt(origin: string, workspaceId: string, threadId: string): Promise<BootstrapResponse> {
  const response = await fetch(endpoint(origin, workspaceId, `bootstrap?thread=${encodeURIComponent(threadId)}`), { signal: AbortSignal.timeout(10_000) });
  expect(response.status).toBe(200);
  expect(response.headers.get("X-Napier-Workspace-Id")).toBe(workspaceId);
  return response.json();
}

function launch(stateHome: string, workspaceRoot: string, mode: string) {
  const child = fork(fileURLToPath(new URL("./workspace-runtime-recovery-process-fixture.ts", import.meta.url)),
    [stateHome, workspaceRoot, mode], {
      execArgv: ["--import", "tsx"], stdio: ["ignore", "pipe", "pipe", "ipc"],
      env: { PATH: process.env.PATH, NAPIER_STATE_HOME: stateHome, NODE_ENV: "test" },
    });
  const exited = once(child, "exit");
  const messages: Array<{ type: string; origin?: string; root?: string; runId?: string }> = [];
  let stderr = "";
  child.stderr?.on("data", (chunk) => { stderr = (stderr + String(chunk)).slice(-16_000); });
  child.stdout?.on("data", () => undefined);
  child.on("message", (message) => messages.push(message as (typeof messages)[number]));
  return { child, exited, messages, async origin() {
    await vi.waitFor(() => {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Recovery host exited: ${stderr}`);
      expect(messages.find((message) => message.type === "ready")?.origin).toBeTruthy();
    }, { timeout: 15_000 });
    return messages.find((message) => message.type === "ready")!.origin!;
  } };
}
