import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { AgentRuntime } from "../src/agent-runtime.js";
import { LocalStore } from "../src/store.js";
import { ModelRegistry } from "../src/models.js";
import {
  captureRunInputWorkspace,
  RUN_INPUT_LIMITS,
} from "../src/run-input-workspace.js";
import {
  runInputCapsuleStore,
  validateRunInputCapsule,
} from "../src/run-input-capsule.js";
import { exportRunInputReproduction } from "../src/run-input-reproduction.js";
import { canonicalJson, sha256 } from "../src/ed25519.js";

const roots: string[] = [];
const stores: LocalStore[] = [];
afterEach(async () => {
  for (const s of stores.splice(0)) s.close();
  await Promise.all(
    roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-run-input-"));
  roots.push(root);
  const dataRoot = path.join(root, "data"),
    workspaceRoot = path.join(root, "workspace");
  const store = new LocalStore({ dataRoot, workspaceRoot });
  stores.push(store);
  await store.initialize();
  await mkdir(workspaceRoot, { recursive: true });
  const agent = store.listAgents()[0]!;
  await store.updateAgent(agent.id, {
    enabledTools: ["read_file"],
    enabledSkills: [],
    enabledSubagents: [],
  });
  const thread = await store.createThread({
    title: "Capture",
    agentId: agent.id,
  });
  return { root, dataRoot, workspaceRoot, store, thread, agent };
}

it("captures before the first model call and reconstructs a failed task after source changes and store reopen", async () => {
  const f = await fixture();
  await writeFile(path.join(f.workspaceRoot, "source.txt"), "ORIGINAL_INPUT\n");
  await mkdir(path.join(f.workspaceRoot, "empty"));
  await chmod(path.join(f.workspaceRoot, "empty"), 0o750);
  await chmod(path.join(f.workspaceRoot, "source.txt"), 0o640);
  const provider = fauxProvider({ provider: "run-input" });
  let first = true;
  provider.setResponses([
    async (context) => {
      expect(JSON.stringify(context)).not.toContain("napier.run-input-capsule");
      first = false;
      await writeFile(
        path.join(f.workspaceRoot, "source.txt"),
        "CHANGED_AFTER_CAPTURE\n",
      );
      return fauxAssistantMessage(
        fauxToolCall("read_file", { path: "missing.txt" }),
      );
    },
    fauxAssistantMessage("The requested file is missing."),
    fauxAssistantMessage('{"facts":[]}'),
  ]);
  const models = new ModelRegistry();
  models.registerProvider(provider.provider);
  const run = await new AgentRuntime(f.store, models).runPrompt({
    threadId: f.thread.id,
    text: "  Inspect missing.txt\n",
    model: { provider: "run-input", id: "faux-1" },
    captureInitialState: true,
  });
  expect(first).toBe(false);
  const events = await f.store.listRunEvents(run.id);
  const capture = events.find((e) => e.type === "run.inputs.captured")!;
  expect(capture.payload).toMatchObject({ status: "captured", fileCount: 1 });
  expect(events.some((e) => e.type === "tool.failed")).toBe(true);
  f.store.close();
  stores.splice(stores.indexOf(f.store), 1);
  const reopened = new LocalStore({
    dataRoot: f.dataRoot,
    workspaceRoot: f.workspaceRoot,
  });
  stores.push(reopened);
  await reopened.initialize();
  const output = path.join(f.root, "reproduction");
  const result = await exportRunInputReproduction({
    store: reopened,
    threadId: f.thread.id,
    runId: run.id,
    output,
  });
  expect(result.workspaceComplete).toBe(true);
  expect(await readFile(path.join(output, "prompt.md"), "utf8")).toBe(
    "Inspect missing.txt",
  );
  expect(await readFile(path.join(output, "fixture/source.txt"), "utf8")).toBe(
    "ORIGINAL_INPUT\n",
  );
  expect((await stat(path.join(output, "fixture/empty"))).isDirectory()).toBe(
    true,
  );
  expect((await stat(path.join(output, "fixture/empty"))).mode & 0o777).toBe(
    0o750,
  );
  expect(
    (await stat(path.join(output, "fixture/source.txt"))).mode & 0o777,
  ).toBe(0o640);
  expect(await readFile(path.join(f.workspaceRoot, "source.txt"), "utf8")).toBe(
    "CHANGED_AFTER_CAPTURE\n",
  );
  expect((await stat(output)).mode & 0o077).toBe(0);
  expect(
    (await stat(path.join(output, "initial-invocation.json"))).mode & 0o077,
  ).toBe(0);
  await expect(
    exportRunInputReproduction({
      store: reopened,
      threadId: f.thread.id,
      runId: run.id,
      output,
    }),
  ).rejects.toThrow();
  expect(await readFile(path.join(output, "fixture/source.txt"), "utf8")).toBe(
    "ORIGINAL_INPUT\n",
  );
});

it("omits credentials, runtime data and symlinks and marks the workspace incomplete", async () => {
  const f = await fixture();
  for (const file of [".env", ".env.local", "credential.pem", ".npmrc"])
    await writeFile(path.join(f.workspaceRoot, file), "SECRET_NOT_CAPTURED");
  await writeFile(path.join(f.root, "outside.txt"), "OUTSIDE_NOT_CAPTURED");
  await symlink(
    path.join(f.root, "outside.txt"),
    path.join(f.workspaceRoot, "link.txt"),
  );
  await mkdir(path.join(f.workspaceRoot, "nested-data"));
  await writeFile(
    path.join(f.workspaceRoot, "nested-data/token.txt"),
    "RUNTIME_SECRET",
  );
  await writeFile(path.join(f.workspaceRoot, "source.txt"), "source");
  const captured = await captureRunInputWorkspace({
    workspaceRoot: f.workspaceRoot,
    dataRoot: path.join(f.workspaceRoot, "nested-data"),
  });
  expect(captured.files.map((file) => file.path)).toEqual(["source.txt"]);
  expect(captured.omissions).toHaveLength(6);
  expect(JSON.stringify(captured)).not.toMatch(
    /SECRET|OUTSIDE|token.txt|\.env/,
  );
});

it.each([false, true])(
  "does not fail the task when capture is disabled or storage is unavailable: %s",
  async (enabled) => {
    const f = await fixture();
    await writeFile(path.join(f.dataRoot, "run-inputs"), "not a directory");
    const provider = fauxProvider({ provider: "capture-unavailable" });
    provider.setResponses([
      fauxAssistantMessage("Completed."),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const models = new ModelRegistry();
    models.registerProvider(provider.provider);
    const run = await new AgentRuntime(f.store, models).runPrompt({
      threadId: f.thread.id,
      text: "Return Completed.",
      captureInitialState: enabled,
      model: { provider: "capture-unavailable", id: "faux-1" },
    });
    expect(run.status, run.error).toBe("completed");
    const capture = (await f.store.listRunEvents(run.id)).filter(
      (e) => e.type === "run.inputs.captured",
    );
    expect(capture).toHaveLength(enabled ? 1 : 0);
    if (enabled)
      expect(capture[0]?.payload).toMatchObject({ status: "unavailable" });
  },
);

it("bounds file bytes and honors cancellation before any capture", async () => {
  const f = await fixture();
  const large = path.join(f.workspaceRoot, "large.bin");
  await writeFile(large, "");
  await truncate(large, RUN_INPUT_LIMITS.bytes + 1);
  const input = { workspaceRoot: f.workspaceRoot, dataRoot: f.dataRoot };
  const result = await captureRunInputWorkspace(input);
  expect(result.files).toHaveLength(0);
  expect(result.omissions).toEqual([
    { pathSha256: sha256("large.bin"), reason: "byte_limit" },
  ]);
  await expect(
    captureRunInputWorkspace({
      ...input,
      signal: AbortSignal.abort(new Error("cancelled")),
    }),
  ).rejects.toThrow("cancelled");
});

it("does not capture workspace files when the Run lacks file access", async () => {
  const f = await fixture();
  await f.store.updateAgent(f.agent.id, { enabledTools: [] });
  await writeFile(
    path.join(f.workspaceRoot, "not-authorized.txt"),
    "DO_NOT_CAPTURE",
  );
  const provider = fauxProvider({ provider: "no-file-access" });
  provider.setResponses([
    fauxAssistantMessage("Completed."),
    fauxAssistantMessage('{"facts":[]}'),
  ]);
  const models = new ModelRegistry();
  models.registerProvider(provider.provider);
  const run = await new AgentRuntime(f.store, models).runPrompt({
    threadId: f.thread.id,
    text: "Return Completed.",
    captureInitialState: true,
    model: { provider: "no-file-access", id: "faux-1" },
  });
  expect(run.status, run.error).toBe("completed");
  expect(
    (await f.store.listRunEvents(run.id)).find(
      (e) => e.type === "run.inputs.captured",
    )?.payload,
  ).toMatchObject({ status: "unavailable" });
  await expect(stat(path.join(f.dataRoot, "run-inputs"))).rejects.toThrow();
});

it("rejects tampered contents and path traversal even with a recomputed outer hash", async () => {
  const f = await fixture();
  const content = {
    kind: "napier.run-input-capsule" as const,
    schemaVersion: 1 as const,
    threadId: f.thread.id,
    runId: "run_12345678",
    workspaceRootSha256: sha256(f.workspaceRoot),
    configurationSha256: sha256("configuration"),
    promptSha256: sha256("prompt"),
    startedAt: new Date().toISOString(),
    capturedAt: new Date().toISOString(),
    files: [
      {
        path: "../outside",
        mode: 0o600,
        sha256: sha256("test"),
        data: Buffer.from("test").toString("base64"),
      },
    ],
    directories: [],
    omissions: [],
    bytes: 4,
  };
  expect(() =>
    validateRunInputCapsule({
      ...content,
      contentSha256: sha256(canonicalJson(content)),
    }),
  ).toThrow();
  content.files[0]!.path = "source.txt";
  const good = { ...content, contentSha256: sha256(canonicalJson(content)) };
  const storage = runInputCapsuleStore(f.dataRoot);
  await storage.put(good.contentSha256, canonicalJson(good));
  await writeFile(
    path.join(storage.rootPath, `${good.contentSha256}.json`),
    canonicalJson({ ...good, bytes: 5 }),
  );
  await expect(storage.read(good.contentSha256)).rejects.toThrow();
});
