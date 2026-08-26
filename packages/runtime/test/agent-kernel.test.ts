import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ARTIFACT_KERNEL_PLUGIN_ID,
  BROWSER_KERNEL_PLUGIN_ID,
  createAgentKernel,
  createKernelServiceKey,
  KERNEL_CONVERSATION_ARTIFACTS,
  KERNEL_MODEL_ADAPTER,
  KERNEL_MODEL_CALL_PIPELINE,
  KERNEL_POLICY_ADAPTER,
  KERNEL_PROMPT_ADAPTER,
  KERNEL_TOOL_ADAPTER,
  KERNEL_TURN_PIPELINE,
  resolveKernelProfile,
  SEARCH_KERNEL_PLUGIN_ID,
} from "../src/kernel.js";
import { createAgentPromptBuilder } from "../src/agent-prompt-builder.js";
import { AgentRuntime } from "../src/agent-runtime.js";
import { createLocalAgentRuntime } from "../src/local-agent-runtime.js";
import { ModelRegistry } from "../src/models.js";
import { LocalStore } from "../src/store.js";
import { UnsupportedSandboxAdapter } from "../src/sandbox.js";
import {
  processReadySandbox,
  settledProcess,
} from "./process-run-readiness-test-fixture.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Agent Kernel", () => {
  it("resolves deterministic base, Web, and CLI profiles", () => {
    const base = resolveKernelProfile("base");
    const web = resolveKernelProfile("web");
    const cli = resolveKernelProfile("cli");

    expect(base.lineage).toEqual(["base"]);
    expect(web.lineage).toEqual(["base", "web"]);
    expect(cli.lineage).toEqual(["base", "cli"]);
    expect(web.entryPoints).toEqual(
      expect.arrayContaining(["http", "sse", "browser-confirmation"]),
    );
    expect(cli.entryPoints).toEqual(
      expect.arrayContaining(["terminal", "jsonl", "rpc"]),
    );
    expect(
      new Set([base.contentSha256, web.contentSha256, cli.contentSha256]).size,
    ).toBe(3);
  });

  it("runs a real tool task through assembled adapters and typed hooks", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-agent-kernel-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const omittedToolResultMarker = "private middle must be pruned";
    await writeFile(
      path.join(workspaceRoot, "evidence.txt"),
      [
        "kernel evidence",
        "x".repeat(20_000),
        omittedToolResultMarker,
        "y".repeat(20_000),
        "retained tail",
      ].join("\n"),
    );
    const services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot: path.join(root, "state"),
      kernelProfile: "cli",
      sandbox: new UnsupportedSandboxAdapter("kernel-test"),
    });
    try {
      const agent = await services.store.updateAgent(
        services.store.listAgents()[0]!.id,
        {
          toolPolicy: "observe",
          enabledTools: ["read_file"],
        },
      );
      const thread = await services.store.createThread({
        title: "Kernel vertical",
        agentId: agent.id,
      });
      const provider = fauxProvider({ provider: "faux-kernel" });
      provider.setResponses([
        (context) => {
          expect(JSON.stringify(context.messages)).toContain(
            "Kernel realtime extension marker",
          );
          expect(context.systemPrompt).toContain("<model_adapter");
          expect(context.systemPrompt).toContain("<model_harness");
          expect(context.systemPrompt).toContain("Active tools (8)");
          return fauxAssistantMessage(
            fauxToolCall("read_file", { path: "evidence.txt" }),
            { stopReason: "toolUse" },
          );
        },
        (context) => {
          expect(JSON.stringify(context.messages)).toContain("kernel evidence");
          expect(JSON.stringify(context.messages)).not.toContain(
            omittedToolResultMarker,
          );
          return fauxAssistantMessage("Kernel read verified.");
        },
        fauxAssistantMessage('{"facts":[]}'),
      ]);
      services.models.registerProvider(provider.provider);

      expect(
        (await services.kernel.services.resolve(KERNEL_MODEL_ADAPTER)).registry,
      ).toBe(services.models);
      expect(
        (await services.kernel.services.resolve(KERNEL_MODEL_ADAPTER)).pipeline,
      ).toBe(services.kernel.modelCalls);
      expect(
        await services.kernel.services.resolve(KERNEL_MODEL_CALL_PIPELINE),
      ).toBe(services.kernel.modelCalls);
      expect(
        (await services.kernel.services.resolve(KERNEL_PROMPT_ADAPTER)).id,
      ).toBe("napier.prompt.default");
      expect(
        (await services.kernel.services.resolve(KERNEL_TOOL_ADAPTER)).id,
      ).toBe("napier.tool.default");
      expect(
        (await services.kernel.services.resolve(KERNEL_POLICY_ADAPTER)).id,
      ).toBe("napier.policy.default");
      expect(await services.kernel.services.resolve(KERNEL_TURN_PIPELINE)).toBe(
        services.kernel.turnPipeline,
      );

      const observed: string[] = [];
      for (const name of [
        "turn.start",
        "turn.end",
        "model.request",
        "tool.request",
        "tool.result",
        "completion.control",
      ] as const) {
        services.kernel.hooks.on(name, () => observed.push(name), "test.hooks");
      }
      const plugin = services.kernel.scope("plugin.fixture");
      const pluginKey = createKernelServiceKey<string>("plugin.fixture.value");
      let pluginDisposed = false;
      plugin.register({
        key: pluginKey,
        create: () => "active",
        dispose: () => {
          pluginDisposed = true;
        },
      });
      let pluginToolRequests = 0;
      plugin.on("tool.request", () => {
        pluginToolRequests += 1;
      });
      await expect(services.kernel.services.resolve(pluginKey)).resolves.toBe(
        "active",
      );
      const modelCallPhases: string[] = [];
      const modelCallSawOmittedToolResult: boolean[] = [];
      const lifecyclePhases: string[] = [];
      plugin.interceptModelCall({
        id: "test.context-marker",
        prepare: (call) => {
          modelCallPhases.push(`prepare:${call.attempt}`);
          modelCallSawOmittedToolResult.push(
            JSON.stringify(call.context.messages).includes(
              omittedToolResultMarker,
            ),
          );
          return {
            context: {
              ...call.context,
              messages: [
                ...call.context.messages,
                {
                  role: "user",
                  content: "Kernel realtime extension marker",
                  timestamp: Date.now(),
                },
              ],
            },
          };
        },
        around: (_call, next) => {
          modelCallPhases.push("around");
          return next();
        },
      });
      plugin.interceptStep({
        id: "test.step-observer",
        around: async (context, next) => {
          lifecyclePhases.push(
            `step:${context.stepIndex}:enter:${context.capabilityView.activeToolNames().includes("read_file")}`,
          );
          const result = await next();
          lifecyclePhases.push(`step:${context.stepIndex}:exit`);
          return result;
        },
      });
      plugin.interceptTool({
        id: "test.tool-observer",
        around: async (context, next) => {
          lifecyclePhases.push(`tool:${context.toolCall.name}:enter`);
          const result = await next();
          lifecyclePhases.push(`tool:${context.toolCall.name}:exit`);
          return result;
        },
      });
      plugin.interceptCompletion({
        id: "test.completion-observer",
        around: async (context, next) => {
          lifecyclePhases.push(`completion:${context.status}:enter`);
          const result = await next();
          lifecyclePhases.push(`completion:${context.status}:exit`);
          return result;
        },
      });

      const run = await services.kernel.runPrompt({
        threadId: thread.id,
        text: "Read the evidence file and report the verified result.",
        model: { provider: "faux-kernel", id: "faux-1" },
      });

      expect(run.status, run.error).toBe("completed");
      expect(observed).toEqual(
        expect.arrayContaining([
          "turn.start",
          "turn.end",
          "model.request",
          "tool.request",
          "tool.result",
          "completion.control",
        ]),
      );
      expect(pluginToolRequests).toBe(1);
      expect(modelCallPhases).toEqual([
        "prepare:1",
        "around",
        "prepare:1",
        "around",
      ]);
      expect(modelCallSawOmittedToolResult).toEqual([false, false]);
      expect(lifecyclePhases).toEqual([
        "step:1:enter:true",
        "step:1:exit",
        "tool:read_file:enter",
        "tool:read_file:exit",
        "step:2:enter:true",
        "step:2:exit",
        "completion:completed:enter",
        "completion:completed:exit",
      ]);
      const inspection = services.kernel.inspect();
      expect(inspection.profile.id).toBe("cli");
      expect(inspection.plugins).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: ARTIFACT_KERNEL_PLUGIN_ID,
            version: "1.0.0",
            status: "enabled",
            trust: "first_party",
            capabilities: ["projection"],
            contributions: expect.objectContaining({
              projections: ["conversation.artifacts"],
            }),
          }),
          expect.objectContaining({
            id: SEARCH_KERNEL_PLUGIN_ID,
            status: "enabled",
            capabilities: ["tool"],
            permissions: ["network.public"],
            contributions: expect.objectContaining({
              tools: ["web_search"],
            }),
          }),
          expect.objectContaining({
            id: BROWSER_KERNEL_PLUGIN_ID,
            status: "enabled",
            capabilities: ["tool", "ui_slot"],
            permissions: [
              "browser.control",
              "network.public",
              "workspace.read",
              "workspace.write",
            ],
            contributions: expect.objectContaining({
              tools: ["browser"],
              uiSlots: ["inspector.panel"],
            }),
            clientEntry: "@napier/web/kernel-browser-inspector-slot",
          }),
        ]),
      );
      expect(inspection.services).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "runtime.model", state: "resolved" }),
          expect.objectContaining({
            id: "runtime.model-call-pipeline",
            state: "resolved",
          }),
          expect.objectContaining({ id: "runtime.prompt", state: "resolved" }),
          expect.objectContaining({ id: "runtime.tool", state: "resolved" }),
          expect.objectContaining({ id: "runtime.policy", state: "resolved" }),
          expect.objectContaining({
            id: "runtime.turn-pipeline",
            state: "resolved",
          }),
        ]),
      );
      expect(inspection.turnPipeline).toEqual({
        promptAdapterId: "napier.prompt.default",
        toolAdapterId: "napier.tool.default",
        policyAdapterId: "napier.policy.default",
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      });
      expect(inspection.modelCalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "napier.model-aware-harness",
            owner: "kernel.harness",
            prepare: true,
          }),
          expect.objectContaining({
            id: "napier.context-projection-service.prepare",
            owner: "kernel.context",
            order: -400,
            prepare: true,
          }),
          expect.objectContaining({
            id: "napier.context-projection-service",
            owner: "kernel.context",
            order: 10_000,
            finalize: true,
          }),
          expect.objectContaining({
            id: "test.context-marker",
            owner: "plugin.fixture",
            prepare: true,
            around: true,
          }),
        ]),
      );
      expect(inspection.lifecyclePipelines).toEqual({
        step: [
          expect.objectContaining({
            id: "test.step-observer",
            owner: "plugin.fixture",
            boundary: "external",
          }),
        ],
        tool: [
          expect.objectContaining({
            id: "test.tool-observer",
            owner: "plugin.fixture",
            boundary: "external",
          }),
        ],
        completion: [
          expect.objectContaining({
            id: "test.completion-observer",
            owner: "plugin.fixture",
            boundary: "external",
          }),
        ],
      });
      expect(inspection.completionControl).toEqual(
        expect.objectContaining({
          total: 1,
          counts: { "run.completed": 1 },
          latest: expect.objectContaining({ runId: run.id }),
        }),
      );

      await services.kernel.plugins.disable(ARTIFACT_KERNEL_PLUGIN_ID);
      expect(
        services.kernel
          .inspect()
          .plugins.find(
            (candidate) => candidate.id === ARTIFACT_KERNEL_PLUGIN_ID,
          )?.status,
      ).toBe("disabled");
      expect(services.kernel.inspect().services).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: KERNEL_CONVERSATION_ARTIFACTS.id }),
        ]),
      );
      await expect(
        services.kernel.conversationArtifacts.project(thread.id),
      ).rejects.toThrow("not registered");
      await services.kernel.plugins.enable(ARTIFACT_KERNEL_PLUGIN_ID);
      await expect(
        services.kernel.conversationArtifacts.project(thread.id),
      ).resolves.toEqual(
        expect.objectContaining({ projectionId: "conversation.artifacts" }),
      );
      expect(
        services.kernel
          .inspect()
          .services.find(
            (service) => service.id === KERNEL_CONVERSATION_ARTIFACTS.id,
          ),
      ).toEqual(
        expect.objectContaining({
          owner: ARTIFACT_KERNEL_PLUGIN_ID,
          state: "resolved",
        }),
      );

      await plugin.dispose();
      expect(pluginDisposed).toBe(true);
      expect(services.kernel.inspect().services).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ owner: "plugin.fixture" }),
        ]),
      );
      expect(services.kernel.inspect().hooks).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            owners: expect.arrayContaining(["plugin.fixture"]),
          }),
        ]),
      );
      expect(services.kernel.inspect().modelCalls).toEqual([
        expect.objectContaining({
          id: "napier.model-aware-harness",
          owner: "kernel.harness",
        }),
        expect.objectContaining({
          id: "napier.context-projection-service.prepare",
          owner: "kernel.context",
          order: -400,
        }),
        expect.objectContaining({
          id: "napier.context-projection-service",
          owner: "kernel.context",
          order: 10_000,
        }),
      ]);
      expect(services.kernel.inspect().lifecyclePipelines).toEqual({
        step: [],
        tool: [],
        completion: [],
      });
      const harnessEvents = (await services.store.listEvents(thread.id)).filter(
        (event) => event.type === "model.harness.resolved",
      );
      expect(harnessEvents).toHaveLength(2);
      expect(harnessEvents[0]?.payload).toEqual(
        expect.objectContaining({
          family: "generic",
          toolSurface: "full",
          activeToolNames: expect.arrayContaining(["read_file"]),
          contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      );
      const prepared = (await services.store.listEvents(thread.id)).find(
        (event) => event.type === "context.prepared",
      );
      expect(prepared?.payload).toEqual(
        expect.objectContaining({
          turnPipelineSha256: inspection.turnPipeline.contentSha256,
          candidateToolSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          activeToolSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      );
      const pruningEvents = (await services.store.listEvents(thread.id)).filter(
        (event) => event.type === "model.context.tool-results.pruned",
      );
      expect(pruningEvents).toHaveLength(2);
      expect(pruningEvents[1]?.payload).toEqual(
        expect.objectContaining({
          kind: "napier.tool-result-context-pruning",
          toolResultCount: 1,
          contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      );
      const projectionEvents = (
        await services.store.listEvents(thread.id)
      ).filter((event) => event.type === "context.projected");
      expect(projectionEvents).toHaveLength(2);
      expect(projectionEvents[1]?.payload).toEqual(
        expect.objectContaining({
          kind: "napier.context-projection",
          status: "projected",
          durableMessageSource: "durable_run_context",
          skillCatalog: "absent",
          memory: "absent",
          compactionCheckpoint: "absent",
          cacheRetention: "provider_default",
          toolResultPruning: "applied",
          prunedToolResultCount: 1,
          activeMessageSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      );
      expect(JSON.stringify(projectionEvents)).not.toContain("kernel evidence");

      const firstProvider = fauxProvider({ provider: "faux-replaceable" });
      firstProvider.setResponses([
        fauxAssistantMessage("First provider implementation."),
        fauxAssistantMessage('{"facts":[]}'),
      ]);
      services.models.registerProvider(firstProvider.provider);
      const firstThread = await services.store.createThread({
        title: "First provider implementation",
        agentId: agent.id,
      });
      const firstRun = await services.kernel.runPrompt({
        threadId: firstThread.id,
        text: "Use the first provider implementation.",
        model: { provider: "faux-replaceable", id: "faux-1" },
      });
      expect(firstRun.status).toBe("completed");

      const secondProvider = fauxProvider({ provider: "faux-replaceable" });
      secondProvider.setResponses([
        fauxAssistantMessage("Replacement provider implementation."),
        fauxAssistantMessage('{"facts":[]}'),
      ]);
      services.models.registerProvider(secondProvider.provider);
      const replacementThread = await services.store.createThread({
        title: "Replacement provider implementation",
        agentId: agent.id,
      });
      const replacementRun = await services.kernel.runPrompt({
        threadId: replacementThread.id,
        text: "Use the replacement provider implementation.",
        model: { provider: "faux-replaceable", id: "faux-1" },
      });
      expect(replacementRun.status).toBe("completed");
      expect(firstProvider.state.callCount).toBe(2);
      expect(secondProvider.state.callCount).toBe(2);
      expect(
        (await services.store.listEvents(replacementThread.id)).findLast(
          (event) => event.type === "message.assistant",
        )?.payload,
      ).toEqual(
        expect.objectContaining({
          text: "Replacement provider implementation.",
        }),
      );
      expect(lifecyclePhases).toHaveLength(8);

      const narrowedProvider = fauxProvider({ provider: "faux-narrowed" });
      narrowedProvider.setResponses([
        (context) => {
          expect(context.tools?.map((tool) => tool.name)).not.toContain(
            "read_file",
          );
          return fauxAssistantMessage(
            fauxToolCall("read_file", { path: "evidence.txt" }),
            { stopReason: "toolUse" },
          );
        },
        (context) => {
          expect(JSON.stringify(context.messages)).toContain(
            "Tool read_file is not active for this step",
          );
          expect(JSON.stringify(context.messages)).not.toContain(
            "kernel evidence",
          );
          return fauxAssistantMessage("Narrowed capability was enforced.");
        },
        fauxAssistantMessage('{"facts":[]}'),
      ]);
      services.models.registerProvider(narrowedProvider.provider);
      const narrowing = services.kernel.scope("plugin.narrowing-fixture");
      narrowing.interceptStep({
        id: "test.remove-read",
        prepare: (context) => context.capabilityView.restrictTo([]),
      });
      const narrowedThread = await services.store.createThread({
        title: "Kernel lifecycle capability narrowing",
        agentId: agent.id,
      });
      const narrowedRun = await services.kernel.runPrompt({
        threadId: narrowedThread.id,
        text: "Attempt the hidden read tool.",
        model: { provider: "faux-narrowed", id: "faux-1" },
      });
      expect(narrowedRun.status).toBe("completed");
      const narrowedEvents = await services.store.listEvents(narrowedThread.id);
      expect(
        narrowedEvents.filter((event) => event.type === "tool.completed"),
      ).toHaveLength(0);
      expect(
        narrowedEvents.find((event) => event.type === "tool.failed")?.payload,
      ).toEqual(expect.objectContaining({ toolName: "read_file" }));
      expect(
        narrowedEvents.find((event) => event.type === "tool.blocked")?.payload,
      ).toEqual(
        expect.objectContaining({
          toolName: "read_file",
          harnessInterventionReason: "capability_block",
          toolProtocol: expect.objectContaining({
            kind: "napier.tool-ui-projection",
            schemaVersion: 2,
            toolId: "read_file",
            semanticVersion: "2.0.0",
            status: "blocked",
            sideEffect: "none",
            concurrency: "safe",
            compatibilityMode: "native",
          }),
        }),
      );
      await narrowing.dispose();

      const legacyThread = await services.store.createThread({
        title: "Legacy runtime compatibility",
        agentId: agent.id,
      });
      const legacyRun = await services.runtime.runPrompt({
        threadId: legacyThread.id,
        text: "Use the unchanged Runtime API.",
        model: { provider: "napier", id: "demo" },
      });
      expect(legacyRun.status).toBe("completed");

      const guardedProvider = fauxProvider({ provider: "faux-guarded" });
      guardedProvider.setResponses([
        fauxAssistantMessage("This response must not be reached."),
      ]);
      services.models.registerProvider(guardedProvider.provider);
      const guardedThread = await services.store.createThread({
        title: "Kernel model-call invariant",
        agentId: agent.id,
      });
      const unsafe = services.kernel.scope("plugin.unsafe-fixture");
      expect(() =>
        unsafe.interceptModelCall({
          id: "test.before-context-pruning",
          order: -401,
          prepare: () => undefined,
        }),
      ).toThrow(
        "Early model-call order is reserved for the model harness and context pruner",
      );
      unsafe.interceptModelCall({
        id: "test.raise-token-limit",
        prepare: (call) => ({
          options: {
            ...call.options,
            maxTokens: (call.options.maxTokens ?? call.model.maxTokens) + 1,
          },
        }),
      });
      const guardedRun = await services.kernel.runPrompt({
        threadId: guardedThread.id,
        text: "Attempt an unsafe model-call rewrite.",
        model: { provider: "faux-guarded", id: "faux-1" },
      });
      expect(guardedRun.status).toBe("failed");
      expect(guardedRun.error).toContain("model provider call failed");
      expect(guardedProvider.state.callCount).toBe(0);
      await unsafe.dispose();
    } finally {
      await services.shutdown();
      await services.shutdown();
    }
  });

  it("edits and verifies a real workspace through the assembled Kernel path", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-kernel-coding-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
    await mkdir(path.join(workspaceRoot, "node_modules/typescript/bin"), {
      recursive: true,
    });
    await writeFile(
      path.join(workspaceRoot, "node_modules/typescript/bin/tsc"),
      "// kernel verifier fixture\n",
    );
    await writeFile(path.join(workspaceRoot, "tsconfig.json"), "{}\n");
    const filePath = path.join(workspaceRoot, "src/status.ts");
    const before = 'export const status = "draft";\n';
    const after = 'export const status = "verified";\n';
    await writeFile(filePath, before);
    const beforeSha256 = createHash("sha256").update(before).digest("hex");
    const afterSha256 = createHash("sha256").update(after).digest("hex");
    const sandbox = processReadySandbox("kernel-coding", async () =>
      settledProcess("Found 0 type errors.\n"),
    );
    const services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot: path.join(root, "state"),
      kernelProfile: "base",
      sandbox,
    });
    try {
      const agent = await services.store.updateAgent(
        services.store.listAgents()[0]!.id,
        {
          toolPolicy: "workspace",
          enabledTools: ["read_file", "apply_patch", "verify_workspace"],
        },
      );
      const thread = await services.store.createThread({
        title: "Kernel coding vertical",
        agentId: agent.id,
      });
      const provider = fauxProvider({ provider: "faux-kernel-coding" });
      provider.setResponses([
        fauxAssistantMessage(
          fauxToolCall("read_file", { path: "src/status.ts" }),
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage(
          fauxToolCall("apply_patch", {
            operation: "replace",
            path: "src/status.ts",
            expectedSha256: beforeSha256,
            edits: [{ oldText: before, newText: after }],
          }),
          { stopReason: "toolUse" },
        ),
        (context) => {
          expect(JSON.stringify(context.messages)).toContain(afterSha256);
          return fauxAssistantMessage(
            fauxToolCall("verify_workspace", { kind: "typecheck" }),
            { stopReason: "toolUse" },
          );
        },
        (context) => {
          expect(JSON.stringify(context.messages)).toContain(
            "Verification PASSED: typecheck",
          );
          return fauxAssistantMessage("Kernel coding edit verified.");
        },
        fauxAssistantMessage('{"facts":[]}'),
      ]);
      services.models.registerProvider(provider.provider);
      const controls: string[] = [];
      const toolNames: string[] = [];
      services.kernel.hooks.on("tool.request", ({ toolName }) => {
        if (toolName) toolNames.push(toolName);
      });
      services.kernel.hooks.on("completion.control", ({ control }) =>
        controls.push(control),
      );

      const run = await services.kernel.runPrompt({
        threadId: thread.id,
        text: "Update the status and verify the workspace.",
        model: { provider: "faux-kernel-coding", id: "faux-1" },
      });

      expect(run.status, run.error).toBe("completed");
      expect(await readFile(filePath, "utf8")).toBe(after);
      expect(toolNames).toEqual([
        "read_file",
        "apply_patch",
        "verify_workspace",
      ]);
      expect(controls).toEqual(["run.completed"]);
      expect(
        (await services.store.listEvents(thread.id)).find(
          (event) =>
            event.type === "tool.completed" &&
            event.payload &&
            !Array.isArray(event.payload) &&
            typeof event.payload === "object" &&
            event.payload["toolName"] === "verify_workspace",
        )?.payload,
      ).toEqual(
        expect.objectContaining({
          details: expect.objectContaining({ status: "passed" }),
        }),
      );
    } finally {
      await services.shutdown();
    }
  });

  it("runs custom Prompt, Tool, and stricter Policy adapters in the live path and detaches them on shutdown", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-turn-pipeline-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    await writeFile(
      path.join(workspaceRoot, "evidence.txt"),
      "private evidence\n",
    );
    const store = new LocalStore({
      workspaceRoot,
      dataRoot: path.join(root, "state"),
    });
    await store.initialize();
    const models = new ModelRegistry();
    const runtime = new AgentRuntime(
      store,
      models,
      undefined,
      new UnsupportedSandboxAdapter("turn-pipeline-test"),
    );
    const promptCreate: typeof createAgentPromptBuilder = (sources, active) =>
      createAgentPromptBuilder(
        {
          ...sources,
          resolvedSystemPrompt: `${sources.resolvedSystemPrompt}\nKernel prompt adapter marker.`,
        },
        active,
      );
    const selectTools = vi.fn((candidates) => ({
      immediate: candidates.immediate.filter(
        (tool) => tool.name === "read_file",
      ),
      deferred: [],
    }));
    const extraPolicy = vi.fn(() => ({
      block: true as const,
      reason: "Kernel policy adapter blocked this otherwise allowed read",
    }));
    const kernel = await createAgentKernel({
      profile: "base",
      runtime,
      models,
      turnAdapters: {
        prompt: { id: "test.prompt.marker", create: promptCreate },
        tool: { id: "test.tool.read-only", select: selectTools },
        policy: { id: "test.policy.stricter", preflight: extraPolicy },
      },
    });
    let kernelClosed = false;
    try {
      const agent = await store.updateAgent(store.listAgents()[0]!.id, {
        toolPolicy: "observe",
        enabledTools: ["read_file"],
      });
      const thread = await store.createThread({
        title: "Custom Turn Pipeline",
        agentId: agent.id,
      });
      const provider = fauxProvider({ provider: "faux-turn-pipeline" });
      provider.setResponses([
        (context) => {
          expect(context.systemPrompt).toContain(
            "Kernel prompt adapter marker",
          );
          expect(context.tools?.map((tool) => tool.name)).toEqual([
            "read_file",
          ]);
          return fauxAssistantMessage(
            fauxToolCall("read_file", { path: "evidence.txt" }),
            { stopReason: "toolUse" },
          );
        },
        (context) => {
          expect(JSON.stringify(context.messages)).toContain(
            "Kernel policy adapter blocked this otherwise allowed read",
          );
          expect(JSON.stringify(context.messages)).not.toContain(
            "private evidence",
          );
          return fauxAssistantMessage("Stricter Kernel policy verified.");
        },
        fauxAssistantMessage('{"facts":[]}'),
      ]);
      models.registerProvider(provider.provider);

      const run = await kernel.runPrompt({
        threadId: thread.id,
        text: "Try to read the evidence file.",
        model: { provider: "faux-turn-pipeline", id: "faux-1" },
      });

      expect(run.status, run.error).toBe("completed");
      expect(selectTools).toHaveBeenCalledOnce();
      expect(extraPolicy).toHaveBeenCalledOnce();
      expect(kernel.inspect().turnPipeline).toEqual(
        expect.objectContaining({
          promptAdapterId: "test.prompt.marker",
          toolAdapterId: "test.tool.read-only",
          policyAdapterId: "test.policy.stricter",
        }),
      );
      const events = await store.listEvents(thread.id);
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "tool.blocked",
            payload: expect.objectContaining({
              toolName: "read_file",
              policyReason:
                "Kernel policy adapter blocked this otherwise allowed read",
            }),
          }),
          expect.objectContaining({
            type: "context.prepared",
            payload: expect.objectContaining({
              toolCount: 1,
              turnPipelineSha256: kernel.inspect().turnPipeline.contentSha256,
            }),
          }),
        ]),
      );
      expect(events.some((event) => event.type === "tool.completed")).toBe(
        false,
      );

      await kernel.shutdown();
      kernelClosed = true;
      const standaloneThread = await store.createThread({
        title: "Detached Turn Pipeline",
        agentId: agent.id,
      });
      const standaloneProvider = fauxProvider({
        provider: "faux-detached-turn-pipeline",
      });
      standaloneProvider.setResponses([
        (context) => {
          expect(context.systemPrompt).not.toContain(
            "Kernel prompt adapter marker",
          );
          expect(context.tools?.length).toBeGreaterThan(1);
          return fauxAssistantMessage("Standalone defaults restored.");
        },
        fauxAssistantMessage('{"facts":[]}'),
      ]);
      models.registerProvider(standaloneProvider.provider);
      const standaloneRun = await runtime.runPrompt({
        threadId: standaloneThread.id,
        text: "Verify standalone defaults.",
        model: {
          provider: "faux-detached-turn-pipeline",
          id: "faux-1",
        },
      });
      expect(standaloneRun.status, standaloneRun.error).toBe("completed");
      const replacementKernel = await createAgentKernel({
        profile: "base",
        runtime,
        models,
      });
      await replacementKernel.shutdown();
    } finally {
      if (!kernelClosed) await kernel.shutdown();
      store.close();
    }
  });
});
