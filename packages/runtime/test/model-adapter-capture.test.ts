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
      expect(observedOptions[0]?.maxTokens).toBe(16_384);
      expect(observedOptions.at(-1)?.maxTokens).toBe(700);
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
      expect(
        promptPackageEvents.every(
          (event) =>
            event.payload["schemaVersion"] === 3 &&
            event.payload["classification"] === "independent_layers_v1",
        ),
      ).toBe(true);
      expect(adapterEvents[0]?.payload).toEqual(
        expect.objectContaining({
          kind: "napier.model-adapter-selection",
          schemaVersion: 2,
          adapterId: "napier.anthropic-messages.v2",
          family: "anthropic",
          adapterVersion: 2,
          modelApi: "anthropic-messages",
          cacheRetention: "long",
          cacheRetentionSource: "adapter",
          streamOptionMaxTokens: 16_384,
          streamOptionMaxTokensSource: "model",
          modelMaxTokens: 16_384,
          contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      );
      expect(JSON.stringify(adapterEvents)).not.toContain(privatePrompt);
      expect(promptPackageEvents[0]?.payload).toEqual(
        expect.objectContaining({
          kind: "napier.compiled-prompt-package",
          schemaVersion: 3,
          packageVersion: "napier.prompt-context.v3",
          compilerVersion: "napier.prompt-compiler.v1",
          purpose: "agent_turn",
          invariantCore: expect.objectContaining({
            status: "bound",
            version: "napier.invariant-core.v1",
            contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
            bytes: expect.any(Number),
          }),
          turnIndex: 0,
          classification: "independent_layers_v1",
          assembly: "ordered_nonempty_layers_v1",
          tokenEstimateMethod: "sum_layer_ceil_utf8_bytes_div_4",
          lossless: true,
          layers: expect.arrayContaining([
            expect.objectContaining({
              id: "invariant_core",
              source: "compiler_input",
              priority: 1_000,
              budgetBytes: 1_024,
              trimmingReason: "within_budget",
            }),
            expect.objectContaining({
              id: "effective_capabilities",
              source: "compiler_input",
              priority: 800,
              sources: expect.arrayContaining([
                expect.objectContaining({
                  sourceId: "capabilities.effective_run",
                  included: true,
                  required: true,
                }),
                expect.objectContaining({
                  sourceId: "capabilities.workspace_tools",
                  included: true,
                }),
              ]),
            }),
            expect.objectContaining({
              id: "task_skill_overlay",
              source: "compiler_input",
              sources: expect.arrayContaining([
                expect.objectContaining({
                  sourceId: "task.agent_profile",
                  included: true,
                }),
              ]),
            }),
            expect.objectContaining({
              id: "workspace_context",
              source: "compiler_input",
            }),
            expect.objectContaining({
              id: "model_adapter",
              source: "compiler_input",
              sources: [
                expect.objectContaining({
                  sourceId: "model_adapter.anthropic",
                  included: true,
                }),
              ],
            }),
          ]),
          effectiveCapabilities: expect.objectContaining({
            toolCount: expect.any(Number),
            toolNameSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
            toolDefinitionSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          }),
          modelAdapter: {
            adapterId: "napier.anthropic-messages.v2",
            adapterContentSha256: adapterEvents[0]?.payload["contentSha256"],
          },
          contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      );
      expect(JSON.stringify(promptPackageEvents)).not.toContain(privatePrompt);
      expect(promptPackageEvents.at(-1)?.payload).toEqual(
        expect.objectContaining({
          purpose: "memory_extraction",
          invariantCore: { status: "not_applicable" },
          layers: expect.arrayContaining([
            expect.objectContaining({
              id: "task_skill_overlay",
              sources: [
                expect.objectContaining({
                  sourceId: "task.memory_extraction",
                  included: true,
                }),
              ],
            }),
          ]),
        }),
      );
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
      expect(capsule.options.maxTokens).toBe(16_384);
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

  it("dispatches the compiled OpenAI-family Adapter layer on the formal Agent path", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-openai-prompt-compiler-"),
    );
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot: path.join(root, "state"),
      env: {},
      sandbox: new UnsupportedSandboxAdapter("prompt-compiler-openai-test"),
    });
    try {
      let observedSystemPrompt = "";
      const provider = fauxProvider({
        provider: "openai",
        api: "openai-responses",
      });
      provider.setResponses([
        (context) => {
          observedSystemPrompt = context.systemPrompt ?? "";
          return fauxAssistantMessage("OPENAI_COMPILER_DONE");
        },
        () => fauxAssistantMessage('{"facts":[]}'),
      ]);
      services.models.registerProvider(provider.provider);
      const thread = await services.store.createThread({
        title: "OpenAI Prompt Compiler dispatch",
        agentId: services.store.listAgents()[0]!.id,
      });

      const run = await services.runtime.runPrompt({
        threadId: thread.id,
        text: "Return the compiler marker",
        model: { provider: "openai", id: "faux-1" },
      });

      expect(run.status, run.error).toBe("completed");
      expect(observedSystemPrompt).toContain(
        '<model_adapter id="napier.openai-family.v2">',
      );
      expect(observedSystemPrompt).toContain("<effective_capabilities>");
      expect(observedSystemPrompt).toContain(
        "These capabilities are authoritative for this request.",
      );
      expect(observedSystemPrompt).toContain("OpenAI-family function schemas");
      expect(observedSystemPrompt).not.toContain("Anthropic Messages schemas");
      const events = await services.store.listEvents(thread.id);
      const packageEvent = events.find(
        (event) =>
          event.runId === run.id &&
          event.type === "context.prompt_package" &&
          event.payload["turnIndex"] === 0,
      );
      expect(packageEvent?.payload).toEqual(
        expect.objectContaining({
          schemaVersion: 3,
          classification: "independent_layers_v1",
          modelAdapter: {
            adapterId: "napier.openai-family.v2",
            adapterContentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          },
          layers: expect.arrayContaining([
            expect.objectContaining({
              id: "model_adapter",
              sources: [
                expect.objectContaining({
                  sourceId: "model_adapter.openai",
                  included: true,
                }),
              ],
            }),
          ]),
        }),
      );
      const snapshot = await createRunReplaySnapshot(
        services.store,
        thread.id,
        run.id,
      );
      expect(verifyRunReplaySnapshot(snapshot).status).toBe("valid");
    } finally {
      await services.shutdown();
    }
  });

  it("binds one concrete model Harness resolution to Provider context, Ledger, and Prompt Package", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-model-harness-v2-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot: path.join(root, "state"),
      env: {},
      sandbox: new UnsupportedSandboxAdapter("model-harness-v2-test"),
    });
    try {
      let providerSystemPrompt = "";
      let providerToolNames: string[] = [];
      const provider = fauxProvider({
        provider: "openai",
        api: "openai-responses",
        models: [{ id: "gpt-5.4-2026-08-01", reasoning: true }],
      });
      provider.setResponses([
        (context) => {
          providerSystemPrompt = context.systemPrompt ?? "";
          providerToolNames = (context.tools ?? []).map((tool) => tool.name);
          return fauxAssistantMessage("MODEL_HARNESS_V2_DONE");
        },
        () => fauxAssistantMessage('{"facts":[]}'),
      ]);
      services.models.registerProvider(provider.provider);
      const agent = services.store.listAgents()[0]!;
      await services.store.updateAgent(agent.id, {
        enabledTools: [
          "list_files",
          "read_file",
          "search_files",
          "inspect_code",
          "apply_patch",
          "verify_workspace",
          "run_command",
          "workspace_process",
          "javascript_kernel",
          "python_kernel",
          "browser",
          "web_search",
          "web_fetch",
          "inspect_data",
          "data_frame",
          "sqlite_query",
          "git_inspect",
          "git_stage_preview",
          "git_stage_apply",
          "lsp_diagnostics",
          "lsp_symbols",
          "lsp_definition",
          "lsp_references",
        ],
      });
      const thread = await services.store.createThread({
        title: "Concrete model Harness",
        agentId: agent.id,
      });
      const privatePrompt = "Implement and verify PRIVATE_HARNESS_TASK_49b1.";
      const run = await services.runtime.runPrompt({
        threadId: thread.id,
        text: privatePrompt,
        model: { provider: "openai", id: "gpt-5.4-2026-08-01" },
      });

      expect(run.status, run.error).toBe("completed");
      expect(providerToolNames.length).toBeGreaterThan(0);
      expect(providerToolNames.length).toBeLessThanOrEqual(20);
      expect(providerSystemPrompt).toContain(
        '<model_harness id="napier.model-harness-resolution.rules-v1.v2" base="napier.model-harness.openai.v1" rule="openai-reasoning">',
      );
      expect(providerSystemPrompt).toContain("Current task phase: coding.");
      const events = await services.store.listEvents(thread.id);
      const harness = events.find(
        (event) =>
          event.runId === run.id && event.type === "model.harness.resolved",
      );
      expect(harness?.payload).toEqual(
        expect.objectContaining({
          schemaVersion: 2,
          matchedRuleId: "openai-reasoning",
          policySource: "model_rule",
          taskPhase: "coding",
          activeToolCount: providerToolNames.length,
          activeToolNames: providerToolNames,
        }),
      );
      expect(JSON.stringify(harness?.payload)).not.toContain(privatePrompt);
      const envelope = events.find(
        (event) =>
          event.runId === run.id &&
          event.type === "context.model_envelope" &&
          event.payload["turnIndex"] === 0,
      );
      const promptPackage = events.find(
        (event) =>
          event.runId === run.id &&
          event.type === "context.prompt_package" &&
          event.payload["turnIndex"] === 0,
      );
      expect(envelope?.payload).toEqual(
        expect.objectContaining({
          toolCount: harness?.payload["activeToolCount"],
        }),
      );
      expect(promptPackage?.payload).toEqual(
        expect.objectContaining({
          systemPromptSha256: envelope?.payload["systemPromptSha256"],
          effectiveCapabilities: expect.objectContaining({
            toolCount: harness?.payload["activeToolCount"],
          }),
          layers: expect.arrayContaining([
            expect.objectContaining({
              id: "effective_capabilities",
              contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
            }),
          ]),
        }),
      );
      const invocation = events.find(
        (event) =>
          event.runId === run.id &&
          event.type === "context.model_invocation" &&
          event.payload["turnIndex"] === 0,
      );
      const capsule = await services.runtime.modelInvocationCapsules.read(
        String(invocation?.payload["capsuleSha256"]),
      );
      expect(capsule.context.systemPrompt).toBe(providerSystemPrompt);
      expect(capsule.context.tools.map((tool) => tool.name)).toEqual(
        providerToolNames,
      );
    } finally {
      await services.shutdown();
    }
  });
});
