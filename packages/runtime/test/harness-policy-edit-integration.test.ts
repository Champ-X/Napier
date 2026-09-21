import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, expect, it } from "vitest";
import { LocalStore } from "../src/store.js";
import { ModelRegistry } from "../src/models.js";
import { createHarnessPolicyProfile } from "../src/harness-policy-profile.js";
import { createModelHarnessExperimentProfile } from "../src/model-harness-experiment-profile.js";
import { processReadyAgentRuntime } from "./process-run-readiness-test-fixture.js";
import { sha256 } from "../src/ed25519.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

it.each([false, true])(
  "uses snapshot edits through the governed Agent loop with unified diff=%s",
  async (unifiedDiff) => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-policy-agent-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    await writeFile(path.join(workspaceRoot, "price.txt"), "price=10\n");
    const store = new LocalStore({
      workspaceRoot,
      dataRoot: path.join(root, "data"),
    });
    await store.initialize();
    const memory = await store.proposeMemory(
      { content: "Initial price equals ten.", category: "context" },
      {
        type: "manual",
        fileDependencies: [{ path: "price.txt", sha256: sha256("price=10\n") }],
      },
    );
    await store.reviewMemory(memory.id, { action: "approve" });
    const agent = await store.updateAgent(store.listAgents()[0]!.id, {
      toolPolicy: "workspace",
      enabledTools: ["read_file", "apply_patch"],
    });
    const thread = await store.createThread({
      title: "Edit policies",
      agentId: agent.id,
    });
    const provider = fauxProvider({ provider: "policy-edit" });
    provider.setResponses([
      fauxAssistantMessage(fauxToolCall("read_file", { path: "price.txt" }), {
        stopReason: "toolUse",
      }),
      (context) => {
        expect(context.systemPrompt).toContain("Initial price equals ten.");
        expect(context.systemPrompt).toContain(
          `Preferred content edit dialect: ${unifiedDiff ? "unified_diff" : "hashline"}.`,
        );
        const text = JSON.stringify(context.messages);
        const snapshotRef = text.match(/s[0-9a-f]{16}_[0-9]+/u)?.[0];
        expect(snapshotRef).toBeDefined();
        return fauxAssistantMessage(
          fauxToolCall("apply_patch", {
            path: "price.txt",
            snapshotRef,
            ...(unifiedDiff
              ? {
                  operation: "unified_diff",
                  diff: "--- a/price.txt\n+++ b/price.txt\n@@ -1 +1 @@\n-price=10\n+price=12\n",
                }
              : {
                  operation: "hashline_replace",
                  edits: [{ anchorRef: "L1", newText: "price=12" }],
                }),
          }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        expect(context.systemPrompt).toContain("napier.task-working-state");
        expect(context.systemPrompt).toContain('"path":"price.txt"');
        expect(context.systemPrompt).toContain('"current":"matches"');
        expect(context.systemPrompt).not.toContain("Initial price equals ten.");
        return fauxAssistantMessage("Updated the price.");
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const models = new ModelRegistry();
    models.registerProvider(provider.provider);
    const runtime = processReadyAgentRuntime(store, models);
    const profile = createModelHarnessExperimentProfile({
      id: "edits.references.v1",
      maxActiveTools: 20,
      policies: createHarnessPolicyProfile({
        id: "coding-node",
        revision: 1,
        context: {
          prompt: "stable-v1",
          memory: "task-aware-v1",
          workingState: "evidence-v1",
        },
        toolSurface: {
          editReferences: true,
          ...(unifiedDiff ? { unifiedDiff: true } : {}),
          editPreference: {
            provider: "policy-edit",
            model: "faux-1",
            api: provider.getModel().api,
            taskPhase: "coding",
            dialect: unifiedDiff ? "unified_diff" : "hashline",
          },
        },
        verification: "node-v1",
      }),
    });
    const run = await runtime.runPrompt({
      threadId: thread.id,
      text: "Fix price.txt by changing price to 12",
      model: { provider: "policy-edit", id: "faux-1" },
      harnessExperimentProfile: profile,
      onRunCreated: async () => {
        // Caller changes affect subsequent requests, never this already-bound run.
        profile.policies!.toolSurface.editReferences = false;
      },
    });
    const events = await store.listRunEvents(run.id);
    const indexes = events
      .filter((event) => event.type === "context.memory")
      .map(
        (event) => event.payload.index as Record<string, unknown> | undefined,
      );
    expect(
      indexes.some(
        (index) => index?.storage === "persistent" && Number(index.reused) > 0,
      ),
    ).toBe(true);
    expect(indexes.some((index) => Number(index?.deleted) > 0)).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === "context.prompt_package" &&
          event.payload.assembly === "stable_prefix_layers_v1",
      ),
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === "context.prompt_cache_projection" &&
          Number(event.payload.schemaCompatibleSystemPrefixBytes) > 0,
      ),
    ).toBe(true);
    expect(run.status, run.error).toBe("completed");
    expect(await readFile(path.join(workspaceRoot, "price.txt"), "utf8")).toBe(
      "price=12\n",
    );
    expect(
      events.some(
        (event) =>
          event.type === "tool.completed" &&
          event.payload.toolName === "apply_patch",
      ),
    ).toBe(true);
    expect(
      events.some(
        (event) => event.payload.profileSha256 === profile.contentSha256,
      ),
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          typeof event.payload.policyProfileJson === "string" &&
          JSON.parse(event.payload.policyProfileJson).toolSurface
            .editReferences === true,
      ),
    ).toBe(true);
  },
);
