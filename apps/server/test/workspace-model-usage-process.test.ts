import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer, type ServerResponse } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { LocalStore } from "@napier/runtime/store";
import { describe, expect, it } from "vitest";
import { WorkspaceModelAdmission } from "../src/workspace-model-admission.js";
import { measuredMessage } from "./workspace-model-admission-fixture.js";

function worker(mode: string, root: string, url?: string) {
  const child = fork(fileURLToPath(new URL("./workspace-model-usage-process-fixture.ts", import.meta.url)),
    [mode, root, ...(url ? [url] : [])], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"] });
  let errors = "";
  child.stderr?.on("data", (chunk) => { errors += String(chunk); });
  const messages: Array<Record<string, unknown>> = [];
  child.on("message", (value) => messages.push(value as Record<string, unknown>));
  const exited = once(child, "exit");
  async function stage(name: string): Promise<Record<string, unknown>> {
    for (;;) {
      const found = messages.find((message) => message["stage"] === name);
      if (found) return found;
      await Promise.race([once(child, "message"), exited.then(() => { throw new Error(`Usage worker exited before ${name}: ${errors}`); })]);
    }
  }
  return { child, exited, stage };
}
async function kill(child: ChildProcess, exited: ReturnType<typeof once>) {
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  return exited;
}

describe("actual process and loopback model usage durability", () => {
  it.each(["before_receipt", "source_committed", "store_committed"] as const)(
    "retains exact accounting through SIGKILL at %s", async (mode) => {
      const root = await mkdtemp(path.join(os.tmpdir(), "napier-loopback-usage-"));
      let response: ServerResponse | undefined, calls = 0, entered!: () => void;
      const requested = new Promise<void>((resolve) => { entered = resolve; });
      const server = createServer((_request, outgoing) => { calls += 1; response = outgoing; entered(); });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing loopback address");
      const process = worker(mode, root, `http://127.0.0.1:${address.port}/delayed`);
      const replayers: ReturnType<typeof worker>[] = [];
      let admission: WorkspaceModelAdmission | undefined, store: LocalStore | undefined;
      try {
        const terminal = await process.stage("logical_terminal");
        await requested;
        expect(terminal).toMatchObject({ physicalCalls: 1, terminal: { status: "cancelled", usageStatus: "incomplete" },
          budget: { activeInvocations: 1, budgetInvocations: 1 } });
        if (mode !== "before_receipt") {
          const message = { ...fauxAssistantMessage("This late text must not become an assistant event."), usage: measuredMessage().usage };
          expect(message.usage.totalTokens).toBe(14);
          response!.writeHead(200, { "Content-Type": "application/json" }); response!.end(JSON.stringify(message));
          const physical = await process.stage("physical_settled");
          expect(physical).toMatchObject({ physicalCalls: 1, outcome: { status: "rejected" },
            budget: { activeInvocations: 0, chargedTokens: 120, usageProjectionPending: true } });
        }
        expect((await kill(process.child, process.exited))[1]).toBe("SIGKILL");
        expect(calls).toBe(1);
        const metadata = JSON.parse(await readFile(path.join(root, "metadata.json"), "utf8"));
        if (mode === "store_committed") {
          const db = new DatabaseSync(path.join(root, "host/model-admission.sqlite"));
          db.exec("DROP TRIGGER fixture_ack_barrier"); db.close();
        }
        if (mode !== "before_receipt") {
          // Independent processes contend for one outbox delivery. Store claim
          // uniqueness and acknowledgement determine the result, not a JS set.
          replayers.push(worker("replay", root), worker("replay", root));
          const replayed = await Promise.all(replayers.map((entry) => entry.stage("replayed")));
          for (const item of replayed) expect(item).toMatchObject({ run: { status: "cancelled", usageStatus: "complete",
            usage: { inputTokens: 10, outputTokens: 4, costUsd: 0.000018 } }, budget: { budgetInvocations: 1, chargedTokens: 14 } });
          for (const entry of replayers) expect((await entry.exited)[0]).toBe(0);
        }
        admission = await WorkspaceModelAdmission.open(path.join(root, "host"));
        store = new LocalStore({ workspaceRoot: metadata.identity.root, dataRoot: metadata.identity.dataRoot });
        await store.initializeAccounting();
        const run = store.listRuns(metadata.threadId).find((value) => value.id === metadata.runId)!;
        const events = await store.listRunEvents(run.id);
        expect(run.status).toBe("cancelled"); expect(run.finishedAt).toBe(metadata.terminal.finishedAt);
        expect(events.filter((event) => event.type === "run.cancelled")).toEqual(metadata.terminalEvents);
        expect(events.filter((event) => event.type === "message.assistant" || event.type === "model.response")).toHaveLength(0);
        expect(events.filter((event) => event.type === "model.usage.reconciled")).toHaveLength(mode === "before_receipt" ? 0 : 1);
        expect(await store.aggregateRunUsage(run.id)).toEqual(run.usage);
        expect(admission.snapshot()).toMatchObject({ activeInvocations: 0, budgetInvocations: 1,
          chargedTokens: mode === "before_receipt" ? 120 : 14, uncertainInvocations: mode === "before_receipt" ? 1 : 0 });
        expect(run.usageStatus).toBe(mode === "before_receipt" ? "incomplete" : "complete");
        expect(calls).toBe(1);
      } finally {
        await kill(process.child, process.exited);
        for (const entry of replayers) await kill(entry.child, entry.exited);
        store?.close(); admission?.close();
        server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
        await rm(root, { recursive: true, force: true });
      }
    }, 30_000,
  );
});
