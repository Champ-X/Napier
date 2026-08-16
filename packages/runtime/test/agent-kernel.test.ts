import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import {
  ARTIFACT_KERNEL_PLUGIN_ID,
  BROWSER_KERNEL_PLUGIN_ID,
  createKernelServiceKey,
  KERNEL_CONVERSATION_ARTIFACTS,
  KERNEL_MODEL_ADAPTER,
  KERNEL_POLICY_ADAPTER,
  KERNEL_PROMPT_ADAPTER,
  KERNEL_TOOL_ADAPTER,
  resolveKernelProfile,
  SEARCH_KERNEL_PLUGIN_ID,
} from "../src/kernel.js";
import { createAgentPromptBuilder } from "../src/agent-prompt-builder.js";
import { preflightAgentToolPolicy } from "../src/agent-tool-policy-preflight.js";
import { createLocalAgentRuntime } from "../src/local-agent-runtime.js";
import { createWorkspaceTools } from "../src/tools.js";
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
    await writeFile(
      path.join(workspaceRoot, "evidence.txt"),
      "kernel evidence\n",
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
        fauxAssistantMessage(
          fauxToolCall("read_file", { path: "evidence.txt" }),
          { stopReason: "toolUse" },
        ),
        (context) => {
          expect(JSON.stringify(context.messages)).toContain("kernel evidence");
          return fauxAssistantMessage("Kernel read verified.");
        },
        fauxAssistantMessage('{"facts":[]}'),
      ]);
      services.models.registerProvider(provider.provider);

      expect(
        (await services.kernel.services.resolve(KERNEL_MODEL_ADAPTER)).registry,
      ).toBe(services.models);
      expect(
        (await services.kernel.services.resolve(KERNEL_PROMPT_ADAPTER)).create,
      ).toBe(createAgentPromptBuilder);
      expect(
        (await services.kernel.services.resolve(KERNEL_TOOL_ADAPTER))
          .createWorkspaceTools,
      ).toBe(createWorkspaceTools);
      expect(
        (await services.kernel.services.resolve(KERNEL_POLICY_ADAPTER))
          .preflight,
      ).toBe(preflightAgentToolPolicy);

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
          expect.objectContaining({ id: "runtime.prompt", state: "resolved" }),
          expect.objectContaining({ id: "runtime.tool", state: "resolved" }),
          expect.objectContaining({ id: "runtime.policy", state: "resolved" }),
        ]),
      );
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
});
