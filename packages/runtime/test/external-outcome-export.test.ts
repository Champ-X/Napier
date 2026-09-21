import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { AgentRuntime } from "../src/agent-runtime.js";
import { LocalStore } from "../src/store.js";
import { ModelRegistry } from "../src/models.js";
import { exportRunInputReproduction } from "../src/run-input-reproduction.js";
import { canonicalJson, sha256 } from "../src/ed25519.js";

it("exports a caller-reviewed completed outcome without rewriting execution status or accepting mismatched reviews", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "napier-outcome-export-"));
  const workspaceRoot = path.join(root, "workspace");
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  });
  try {
    await mkdir(workspaceRoot);
    await writeFile(path.join(workspaceRoot, "source.txt"), "ORIGINAL\n");
    await store.initialize();
    const agent = store.listAgents()[0]!;
    await store.updateAgent(agent.id, {
      enabledTools: ["read_file"],
      enabledSkills: [],
      enabledSubagents: [],
    });
    const thread = await store.createThread({
      title: "Outcome review",
      agentId: agent.id,
    });
    const provider = fauxProvider({ provider: "external-review" });
    provider.setResponses([
      fauxAssistantMessage("7"),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const models = new ModelRegistry();
    models.registerProvider(provider.provider);
    const run = await new AgentRuntime(store, models).runPrompt({
      threadId: thread.id,
      text: "Respond with 7. Do not use tools.",
      model: { provider: "external-review", id: "faux-1" },
      captureInitialState: true,
    });
    expect(run.status).toBe("completed");
    const events = await store.listRunEvents(run.id);
    expect(events.some((e) => e.type === "tool.failed")).toBe(false);
    const before = canonicalJson(events);
    const originalRun = canonicalJson(store.listRuns(thread.id));
    const input = {
      store,
      threadId: thread.id,
      runId: run.id,
      output: path.join(root, "export"),
    };
    await expect(exportRunInputReproduction(input)).rejects.toThrow(
      "external outcome review",
    );
    const content = {
      kind: "napier.external-outcome-review",
      schemaVersion: 1,
      runId: run.id,
      threadId: thread.id,
      configurationSha256: run.configuration!.contentSha256,
      promptSha256: sha256("Respond with 7. Do not use tools."),
      outcome: "failed",
      method: "human-review",
      evidenceSha256: sha256("An external reviewer rejected the task outcome."),
    };
    const sign = (value: Record<string, unknown>) => ({
      ...value,
      contentSha256: sha256(canonicalJson(value)),
    });
    for (const override of [
      { runId: "run_other00000" },
      { threadId: "thread_other00000" },
      { configurationSha256: sha256("other") },
      { promptSha256: sha256("other") },
      { evidenceSha256: "bad" },
      { outcome: "passed" },
      { authority: "runtime" },
    ])
      await expect(
        exportRunInputReproduction({
          ...input,
          externalOutcomeReview: sign({ ...content, ...override }),
        }),
      ).rejects.toThrow("External outcome review");
    await expect(
      exportRunInputReproduction({
        ...input,
        externalOutcomeReview: {
          ...sign(content),
          contentSha256: sha256("tampered"),
        },
      }),
    ).rejects.toThrow("External outcome review");
    const review = sign(content);
    await expect(
      exportRunInputReproduction({
        ...input,
        store: {
          ...input.store,
          workspaceRoot,
          dataRoot: store.dataRoot,
          listRuns: () => [{ ...run, status: "running" }],
          listRunEvents: async () => events,
        },
        externalOutcomeReview: review,
      }),
    ).rejects.toThrow("settled failure");
    await expect(
      exportRunInputReproduction({
        ...input,
        store: {
          workspaceRoot,
          dataRoot: store.dataRoot,
          listRuns: () => [run],
          listRunEvents: async () =>
            events.filter((e) => e.type !== "run.inputs.captured"),
        },
        externalOutcomeReview: review,
      }),
    ).rejects.toThrow("initial input capsule");
    await writeFile(
      path.join(workspaceRoot, "source.txt"),
      "CHANGED_AFTER_RUN\n",
    );
    await exportRunInputReproduction({
      ...input,
      externalOutcomeReview: review,
    });
    const exported = JSON.parse(
      await readFile(path.join(input.output, "reproduction.json"), "utf8"),
    );
    expect(exported).toMatchObject({
      schemaVersion: 2,
      originalStatus: "completed",
      qualificationReady: false,
      externalOutcomeReview: {
        authority: "caller_assessment",
        receipt: review,
      },
    });
    expect(
      await readFile(path.join(input.output, "fixture/source.txt"), "utf8"),
    ).toBe("ORIGINAL\n");
    expect(canonicalJson(await store.listRunEvents(run.id))).toBe(before);
    expect(canonicalJson(store.listRuns(thread.id))).toBe(originalRun);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
