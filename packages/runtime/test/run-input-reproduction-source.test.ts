import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import type { RunEvent, RunRecord } from "@napier/contracts";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { AgentRuntime } from "../src/agent-runtime.js";
import { LocalStore } from "../src/store.js";
import { ModelRegistry } from "../src/models.js";
import { exportRunInputReproduction } from "../src/run-input-reproduction.js";
import { canonicalJson, sha256 } from "../src/ed25519.js";

let root: string;
let store: LocalStore;
let run: RunRecord;
let events: RunEvent[];
beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "napier-reproduction-source-"));
  store = new LocalStore({
    workspaceRoot: path.join(root, "workspace"),
    dataRoot: path.join(root, "data"),
  });
  await mkdir(store.workspaceRoot);
  await writeFile(path.join(store.workspaceRoot, "source.txt"), "ORIGINAL\n");
  await store.initialize();
  const agent = store.listAgents()[0]!;
  await store.updateAgent(agent.id, {
    enabledTools: ["read_file"],
    enabledSkills: [],
    enabledSubagents: [],
  });
  const thread = await store.createThread({
    title: "Reproduction binding",
    agentId: agent.id,
  });
  const provider = fauxProvider({ provider: "source-proof" });
  provider.setResponses([
    fauxAssistantMessage(fauxToolCall("read_file", { path: "missing.txt" })),
    fauxAssistantMessage("Missing file."),
    fauxAssistantMessage('{"facts":[]}'),
  ]);
  const models = new ModelRegistry();
  models.registerProvider(provider.provider);
  run = await new AgentRuntime(store, models).runPrompt({
    threadId: thread.id,
    text: "Inspect missing.txt",
    model: { provider: provider.provider.id, id: "faux-1" },
    captureInitialState: true,
  });
  events = await store.listRunEvents(run.id);
  expect(
    events.filter(
      (e) =>
        e.type === "context.model_invocation" &&
        fields(e).purpose === "agent_turn",
    ),
  ).toHaveLength(2);
});
afterAll(async () => {
  store?.close();
  if (root) await rm(root, { recursive: true, force: true });
});
function fields(event: RunEvent) {
  return event.payload as Record<string, unknown>;
}
function source(selectedRun = run, selectedEvents = events) {
  return {
    workspaceRoot: store.workspaceRoot,
    dataRoot: store.dataRoot,
    listRuns: () => [selectedRun],
    listRunEvents: async () => selectedEvents,
  };
}

it.each([
  "missing terminal",
  "conflicting terminal",
  "foreign event",
  "duplicate sequence",
  "queued state",
  "damaged invocation receipt",
  "rebound invocation receipt",
  "damaged capture receipt",
  "conflicting terminal payload",
  "unavailable initial invocation",
  "damaged configuration",
  "late original prompt",
])("rejects %s before creating an export", async (variant) => {
  const selectedRun = structuredClone(run);
  let selectedEvents = structuredClone(events);
  const terminal = selectedEvents.find((e) => e.type === `run.${run.status}`)!;
  const invocation = selectedEvents.find(
    (e) =>
      e.type === "context.model_invocation" &&
      fields(e).purpose === "agent_turn",
  )!;
  if (variant === "missing terminal")
    selectedEvents = selectedEvents.filter((e) => e.id !== terminal.id);
  if (variant === "conflicting terminal")
    selectedEvents.push({
      ...terminal,
      id: "event_conflicting",
      seq: terminal.seq + 100,
      type: "run.failed",
    });
  if (variant === "foreign event") selectedEvents[0]!.runId = "run_other0000";
  if (variant === "duplicate sequence")
    selectedEvents.push({ ...terminal, id: "event_duplicate" });
  if (variant === "queued state") selectedRun.status = "queued";
  if (variant === "late original prompt")
    selectedEvents.find(
      (e) =>
        e.type === "message.user" && fields(e).text === "Inspect missing.txt",
    )!.seq = terminal.seq + 100;
  if (variant === "damaged configuration")
    selectedRun.configuration!.enabledTools = [];
  if (variant === "damaged invocation receipt")
    fields(invocation).contextSha256 = sha256("different context");
  if (variant === "rebound invocation receipt") {
    fields(invocation).turnIndex = Number(fields(invocation).turnIndex) + 1;
    const { contentSha256: _hash, ...body } = fields(invocation);
    fields(invocation).contentSha256 = sha256(canonicalJson(body));
  }
  if (variant === "damaged capture receipt")
    fields(
      selectedEvents.find((e) => e.type === "run.inputs.captured")!,
    ).status = "unavailable";
  if (variant === "conflicting terminal payload")
    fields(terminal).status = "failed";
  if (variant === "unavailable initial invocation")
    invocation.type = "context.model_invocation_unavailable";
  const output = path.join(root, variant.replaceAll(" ", "-"));
  await expect(
    exportRunInputReproduction({
      store: source(selectedRun, selectedEvents),
      threadId: run.threadId,
      runId: run.id,
      output,
    }),
  ).rejects.toThrow();
  await expect(stat(output)).rejects.toMatchObject({ code: "ENOENT" });
});

it("selects the initial invocation by ledger sequence even when a reader returns events in reverse order", async () => {
  const output = path.join(root, "reverse-order");
  await exportRunInputReproduction({
    store: source(run, [...events].reverse()),
    threadId: run.threadId,
    runId: run.id,
    output,
  });
  const receipt = JSON.parse(
    await readFile(path.join(output, "reproduction.json"), "utf8"),
  );
  const first = events.find(
    (e) =>
      e.type === "context.model_invocation" &&
      fields(e).purpose === "agent_turn",
  )!;
  expect(receipt.initialInvocationEventId).toBe(first.id);
  expect(receipt.initialInvocationSha256).toBe(fields(first).capsuleSha256);
  expect(canonicalJson(await store.listRunEvents(run.id))).toBe(
    canonicalJson(events),
  );
});

it("exports a coherently interrupted source without changing its recorded outcome", async () => {
  const selectedRun = { ...run, status: "interrupted" as const };
  const selectedEvents = structuredClone(events);
  const terminal = selectedEvents.find((e) => e.type === `run.${run.status}`)!;
  terminal.type = "run.interrupted";
  fields(terminal).status = "interrupted";
  const output = path.join(root, "interrupted-source");
  await exportRunInputReproduction({
    store: source(selectedRun, selectedEvents),
    threadId: run.threadId,
    runId: run.id,
    output,
  });
  const receipt = JSON.parse(
    await readFile(path.join(output, "reproduction.json"), "utf8"),
  );
  expect(receipt.originalStatus).toBe("interrupted");
  expect(receipt.qualificationReady).toBe(false);
});

it.runIf(process.env.NAPIER_LIVE_REPRODUCTION_CLI === "1")(
  "exports through the actual read-only SQLite CLI and leaves the source ledger unchanged",
  async () => {
    const output = path.join(root, "cli-export");
    const script = fileURLToPath(
      new URL(
        "../../../scripts/export-run-input-reproduction.mjs",
        import.meta.url,
      ),
    );
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) =>
          !/API_KEY|TOKEN|SECRET/u.test(key) &&
          !key.startsWith("NAPIER_LIVE_") &&
          key !== "NODE_OPTIONS",
      ),
    );
    const result = await promisify(execFile)(
      process.execPath,
      [
        script,
        "--workspace",
        store.workspaceRoot,
        "--data-root",
        store.dataRoot,
        "--thread",
        run.threadId,
        "--run",
        run.id,
        "--output",
        output,
      ],
      { env },
    );
    expect(JSON.parse(result.stdout)).toMatchObject({
      runId: run.id,
      workspaceComplete: true,
    });
    expect(
      await readFile(path.join(output, "fixture/source.txt"), "utf8"),
    ).toBe("ORIGINAL\n");
    expect(canonicalJson(await store.listRunEvents(run.id))).toBe(
      canonicalJson(events),
    );
  },
);
