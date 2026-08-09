import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import { createLocalAgentRuntime } from "../src/local-agent-runtime.js";
import {
  createRunReplaySnapshot,
  exportThreadReplayBundle,
  verifyRunReplaySnapshot,
} from "../src/replay.js";
import { UnsupportedSandboxAdapter } from "../src/sandbox.js";
import { verifyThreadReplayBundle } from "../src/thread-bundles.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Model adapter capture", () => {
  it("binds one Adapter policy to Provider dispatch, Ledger, and replay capsule", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-model-adapter-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot: path.join(root, "state"),
      env: {},
      sandbox: new UnsupportedSandboxAdapter("model-adapter-test"),
    });
    try {
      const observedOptions: Array<SimpleStreamOptions | undefined> = [];
      const provider = fauxProvider({
        provider: "anthropic",
        api: "anthropic-messages",
      });
      provider.setResponses([
        (_context, options) => {
          observedOptions.push(options);
          return fauxAssistantMessage("ADAPTER_CAPTURE_DONE");
        },
        (_context, options) => {
          observedOptions.push(options);
          return fauxAssistantMessage('{"facts":[]}');
        },
      ]);
      services.models.registerProvider(provider.provider);
      const thread = await services.store.createThread({
        title: "Model Adapter capture",
        agentId: services.store.listAgents()[0]!.id,
      });
      const privatePrompt = "PRIVATE_MODEL_ADAPTER_PROMPT";
      const run = await services.runtime.runPrompt({
        threadId: thread.id,
        text: privatePrompt,
        model: { provider: "anthropic", id: "faux-1" },
      });

      expect(run.status, run.error).toBe("completed");
      expect(observedOptions.length).toBeGreaterThanOrEqual(1);
      expect(
        observedOptions.every((options) => options?.cacheRetention === "long"),
      ).toBe(true);
      const events = await services.store.listEvents(thread.id);
      const adapterEvents = events.filter(
        (event) =>
          event.runId === run.id && event.type === "context.model_adapter",
      );
      const promptPackageEvents = events.filter(
        (event) =>
          event.runId === run.id && event.type === "context.prompt_package",
      );
      expect(adapterEvents.length).toBe(observedOptions.length);
      expect(promptPackageEvents.length).toBe(adapterEvents.length);
      expect(adapterEvents[0]?.payload).toEqual(
        expect.objectContaining({
          kind: "napier.model-adapter-selection",
          schemaVersion: 1,
          adapterId: "napier.anthropic-messages.v1",
          family: "anthropic",
          adapterVersion: 1,
          modelApi: "anthropic-messages",
          cacheRetention: "long",
          cacheRetentionSource: "adapter",
          contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      );
      expect(JSON.stringify(adapterEvents)).not.toContain(privatePrompt);
      expect(promptPackageEvents[0]?.payload).toEqual(
        expect.objectContaining({
          kind: "napier.compiled-prompt-package",
          schemaVersion: 2,
          packageVersion: "napier.prompt-context.v2",
          purpose: "agent_turn",
          invariantCore: expect.objectContaining({
            status: "bound",
            version: "napier.invariant-core.v1",
            contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
            bytes: expect.any(Number),
          }),
          turnIndex: 0,
          classification: "conservative_tagged_v1",
          tokenEstimateMethod: "sum_layer_ceil_utf8_bytes_div_4",
          lossless: true,
          layers: expect.arrayContaining([
            expect.objectContaining({ id: "invariant_core" }),
            expect.objectContaining({ id: "effective_capabilities" }),
            expect.objectContaining({ id: "task_skill_overlay" }),
            expect.objectContaining({ id: "workspace_context" }),
            expect.objectContaining({
              id: "model_adapter",
              contentSha256: adapterEvents[0]?.payload["contentSha256"],
            }),
          ]),
          effectiveCapabilities: expect.objectContaining({
            toolCount: expect.any(Number),
            toolNameSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
            toolDefinitionSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          }),
          modelAdapter: {
            adapterId: "napier.anthropic-messages.v1",
            adapterContentSha256: adapterEvents[0]?.payload["contentSha256"],
          },
          contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      );
      expect(JSON.stringify(promptPackageEvents)).not.toContain(privatePrompt);
      const invocation = events.find(
        (event) =>
          event.runId === run.id &&
          event.type === "context.model_invocation" &&
          event.payload["turnIndex"] === 0,
      );
      expect(invocation).toBeDefined();
      const capsule = await services.runtime.modelInvocationCapsules.read(
        String(invocation!.payload["capsuleSha256"]),
      );
      expect(capsule.options.cacheRetention).toBe("long");
      const snapshot = await createRunReplaySnapshot(
        services.store,
        thread.id,
        run.id,
      );
      expect(verifyRunReplaySnapshot(snapshot)).toEqual(
        expect.objectContaining({
          status: "valid",
          diagnostics: [],
          threadId: thread.id,
          runId: run.id,
        }),
      );
      const bundle = await exportThreadReplayBundle(services.store, thread.id);
      expect(verifyThreadReplayBundle(bundle)).toEqual(
        expect.objectContaining({
          status: "valid",
          diagnostics: [],
          threadId: thread.id,
          runCount: expect.any(Number),
        }),
      );
    } finally {
      await services.shutdown();
    }
  });
});
