import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { agentCapabilityPresetUpdate } from "@napier/contracts/agent-capabilities";
import { afterEach, describe, expect, it } from "vitest";

import { createLocalAgentRuntime } from "../src/local-agent-runtime.js";
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

describe("Capability Catalog Runtime", () => {
  it("activates a harness-omitted first-party tool on the next real step", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-catalog-runtime-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot: path.join(root, "state"),
      sandbox: processReadySandbox("catalog-runtime-test", async () =>
        settledProcess(),
      ),
    });
    try {
      const agent = await services.store.updateAgent(
        services.store.listAgents()[0]!.id,
        agentCapabilityPresetUpdate("safe_automation"),
      );
      const thread = await services.store.createThread({
        title: "Capability Catalog activation",
        agentId: agent.id,
      });
      const provider = fauxProvider({ provider: "faux-catalog-runtime" });
      provider.setResponses([
        (context) => {
          const names = (context.tools ?? []).map((tool) => tool.name);
          expect(names).toContain("capability");
          expect(names).not.toContain("git_commit_apply");
          return fauxAssistantMessage(
            fauxToolCall("capability", {
              uri: "cap://tools/git_commit_apply",
            }),
            { stopReason: "toolUse" },
          );
        },
        (context) => {
          const names = (context.tools ?? []).map((tool) => tool.name);
          expect(names).toContain("capability");
          expect(names).toContain("git_commit_apply");
          expect(JSON.stringify(context.messages)).toContain(
            "cap://tools/git_commit_apply",
          );
          return fauxAssistantMessage("First-party capability activated.");
        },
        fauxAssistantMessage('{"facts":[]}'),
      ]);
      services.models.registerProvider(provider.provider);

      const run = await services.kernel.runPrompt({
        threadId: thread.id,
        text: "Discover a commit capability and make it available without invoking it.",
        model: { provider: provider.provider.id, id: "faux-1" },
      });

      expect(run.status, run.error).toBe("completed");
      const harness = (await services.store.listEvents(thread.id)).filter(
        (event) =>
          event.runId === run.id && event.type === "model.harness.resolved",
      );
      expect(harness).toHaveLength(2);
      expect(harness[0]?.payload["omittedToolNames"]).toContain(
        "git_commit_apply",
      );
      expect(harness[1]?.payload["activeToolNames"]).toContain(
        "git_commit_apply",
      );
    } finally {
      await services.shutdown();
    }
  }, 20_000);

  it("blocks a false missing-shell interruption, discovers the tool, and continues", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-catalog-guard-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot: path.join(root, "state"),
      sandbox: processReadySandbox("catalog-guard-test", async () =>
        settledProcess(),
      ),
    });
    try {
      const agent = await services.store.updateAgent(
        services.store.listAgents()[0]!.id,
        agentCapabilityPresetUpdate("full_access"),
      );
      const thread = await services.store.createThread({
        title: "Capability interruption guard",
        agentId: agent.id,
      });
      const provider = fauxProvider({ provider: "faux-catalog-guard" });
      provider.setResponses([
        (context) => {
          const names = (context.tools ?? []).map((tool) => tool.name);
          expect(names).toContain("capability");
          expect(names).not.toContain("workspace_process");
          expect(context.systemPrompt).not.toContain(
            "Use workspace_process for background Node or shell sessions",
          );
          return fauxAssistantMessage(
            fauxToolCall("request_operator_decision", {
              header: "能力受限",
              question:
                "我没有 Bash 或命令行能力，workspace_process 不可用。你希望我如何继续？",
              options: [
                {
                  label: "提供源码",
                  description: "由操作者手动提供源码。",
                },
                {
                  label: "停止任务",
                  description: "不再继续当前任务。",
                },
              ],
              multiSelect: false,
            }),
            { stopReason: "toolUse" },
          );
        },
        (context) => {
          return fauxAssistantMessage(
            fauxToolCall("capability", { query: "bash" }),
            { stopReason: "toolUse" },
          );
        },
        (context) => {
          expect(JSON.stringify(context.messages)).toContain(
            "cap://tools/workspace_process",
          );
          return fauxAssistantMessage(
            fauxToolCall("capability", {
              uri: "cap://tools/workspace_process",
            }),
            { stopReason: "toolUse" },
          );
        },
        (context) => {
          const names = (context.tools ?? []).map((tool) => tool.name);
          expect(names).toContain("workspace_process");
          expect(context.systemPrompt).toContain(
            "Use workspace_process for background Node or shell sessions",
          );
          return fauxAssistantMessage(
            "The configured shell capability was recovered; continuing without operator interruption.",
          );
        },
        fauxAssistantMessage('{"facts":[]}'),
      ]);
      services.models.registerProvider(provider.provider);

      const run = await services.kernel.runPrompt({
        threadId: thread.id,
        text: "Analyze a CSV dataset and report the statistics.",
        model: { provider: provider.provider.id, id: "faux-1" },
      });

      expect(run.status, run.error).toBe("completed");
      expect(await services.store.listOperatorDecisions(thread.id)).toEqual([]);
      const events = (await services.store.listEvents(thread.id)).filter(
        (event) => event.runId === run.id,
      );
      const blockedDecision = events.find(
        (event) =>
          event.type === "tool.blocked" &&
          event.payload !== null &&
          typeof event.payload === "object" &&
          !Array.isArray(event.payload) &&
          event.payload["toolName"] === "request_operator_decision",
      );
      expect(blockedDecision).toBeDefined();
      expect(JSON.stringify(blockedDecision?.payload)).toContain(
        "configured but hidden by the focused model surface",
      );
      expect(
        events.some(
          (event) =>
            event.type === "tool.completed" &&
            event.payload !== null &&
            typeof event.payload === "object" &&
            !Array.isArray(event.payload) &&
            event.payload["toolName"] === "capability",
        ),
      ).toBe(true);
      expect(events.map((event) => event.type)).not.toContain(
        "run.waiting_for_operator",
      );
      const harness = events.filter(
        (event) => event.type === "model.harness.resolved",
      );
      expect(harness.at(-1)?.payload["activeToolNames"]).toContain(
        "workspace_process",
      );
    } finally {
      await services.shutdown();
    }
  }, 20_000);

  it("keeps the reported Hermes task executable and rejects its exact false blocker", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-hermes-guard-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot: path.join(root, "state"),
      sandbox: processReadySandbox("hermes-guard-test", async () =>
        settledProcess(),
      ),
    });
    try {
      const agent = await services.store.updateAgent(
        services.store.listAgents()[0]!.id,
        agentCapabilityPresetUpdate("full_access"),
      );
      const thread = await services.store.createThread({
        title: "Hermes false capability blocker",
        agentId: agent.id,
      });
      const provider = fauxProvider({ provider: "faux-hermes-guard" });
      provider.setResponses([
        (context) => {
          const names = (context.tools ?? []).map((tool) => tool.name);
          expect(names).toEqual(
            expect.arrayContaining([
              "list_files",
              "read_file",
              "search_files",
              "apply_patch",
              "verify_workspace",
              "run_command",
              "workspace_process",
              "web_search",
              "web_fetch",
              "capability",
            ]),
          );
          expect(context.systemPrompt).toContain(
            "workspace_process with runtime=shell runs one explicit POSIX shell script",
          );
          return fauxAssistantMessage(
            fauxToolCall("request_operator_decision", {
              header: "能力受限",
              question:
                "工作区里没有 Hermes Agent 源码，且我当前没有网络/命令行拉取能力（web_search、web_fetch、run_command、apply_patch、git_* 均不可用）。你希望我如何继续？",
              options: [
                {
                  label: "提供源码",
                  description: "由操作者手动提供源码。",
                },
                {
                  label: "停止任务",
                  description: "不再继续当前任务。",
                },
              ],
              multiSelect: false,
            }),
            { stopReason: "toolUse" },
          );
        },
        (context) => {
          expect(JSON.stringify(context.messages)).toContain(
            "Do not request operator input for a capability blocker",
          );
          return fauxAssistantMessage(
            fauxToolCall("list_files", { path: ".", depth: 2 }),
            { stopReason: "toolUse" },
          );
        },
        (context) => {
          expect(JSON.stringify(context.messages)).toContain("list_files");
          return fauxAssistantMessage(
            "The false capability blocker was rejected; the task can continue with the active tools.",
          );
        },
        fauxAssistantMessage('{"facts":[]}'),
      ]);
      services.models.registerProvider(provider.provider);

      const run = await services.kernel.runPrompt({
        threadId: thread.id,
        text: "深度分析Hermes Agent目前的源码，然后做一个精美全面的HTML来深度介绍它。",
        model: { provider: provider.provider.id, id: "faux-1" },
      });

      expect(run.status, run.error).toBe("completed");
      expect(await services.store.listOperatorDecisions(thread.id)).toEqual([]);
      const events = (await services.store.listEvents(thread.id)).filter(
        (event) => event.runId === run.id,
      );
      expect(events.map((event) => event.type)).not.toContain(
        "run.waiting_for_operator",
      );
      const blockedDecision = events.find(
        (event) =>
          event.type === "tool.blocked" &&
          event.payload !== null &&
          typeof event.payload === "object" &&
          !Array.isArray(event.payload) &&
          event.payload["toolName"] === "request_operator_decision",
      );
      expect(blockedDecision?.payload).toEqual(
        expect.objectContaining({
          harnessInterventionReason: "capability_use_required",
        }),
      );
      expect(
        events.some(
          (event) =>
            event.type === "tool.completed" &&
            event.payload["toolName"] === "list_files",
        ),
      ).toBe(true);
    } finally {
      await services.shutdown();
    }
  }, 20_000);

  it("redirects a plain false-capability final answer back into tool execution", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-final-guard-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot: path.join(root, "state"),
      sandbox: processReadySandbox("final-guard-test", async () =>
        settledProcess(),
      ),
    });
    try {
      const agent = await services.store.updateAgent(
        services.store.listAgents()[0]!.id,
        agentCapabilityPresetUpdate("full_access"),
      );
      const thread = await services.store.createThread({
        title: "Final capability claim guard",
        agentId: agent.id,
      });
      const provider = fauxProvider({ provider: "faux-final-guard" });
      provider.setResponses([
        fauxAssistantMessage(
          "工作区里没有 Hermes Agent 源码，而且 web_search、web_fetch、workspace_process、run_command 和 apply_patch 均不可用，请提供源码。",
        ),
        (context) => {
          expect(JSON.stringify(context.messages)).toContain(
            "Internal capability recovery redirect",
          );
          expect((context.tools ?? []).map((tool) => tool.name)).toContain(
            "list_files",
          );
          return fauxAssistantMessage(
            fauxToolCall("list_files", { path: ".", depth: 2 }),
            { stopReason: "toolUse" },
          );
        },
        fauxAssistantMessage(
          "I used the active workspace capability and continued the original task.",
        ),
        fauxAssistantMessage('{"facts":[]}'),
      ]);
      services.models.registerProvider(provider.provider);

      const run = await services.kernel.runPrompt({
        threadId: thread.id,
        text: "深度分析Hermes Agent目前的源码，然后做一个精美全面的HTML来深度介绍它。",
        model: { provider: provider.provider.id, id: "faux-1" },
      });

      expect(run.status, run.error).toBe("completed");
      const events = (await services.store.listEvents(thread.id)).filter(
        (event) => event.runId === run.id,
      );
      const published = events
        .filter((event) => event.type === "message.assistant")
        .map((event) => event.payload["text"]);
      expect(
        published.some(
          (text) => typeof text === "string" && text.includes("均不可用"),
        ),
      ).toBe(false);
      expect(published).toContain(
        "I used the active workspace capability and continued the original task.",
      );
      expect(
        events.some(
          (event) =>
            event.type === "tool.completed" &&
            event.payload["toolName"] === "list_files",
        ),
      ).toBe(true);
      expect(await services.store.listOperatorDecisions(thread.id)).toEqual([]);
      expect(events.map((event) => event.type)).not.toContain(
        "run.waiting_for_operator",
      );
      expect(
        events.some(
          (event) =>
            event.type === "model.response" &&
            event.payload["responseDisposition"] ===
              "capability_recovery_required",
        ),
      ).toBe(true);
    } finally {
      await services.shutdown();
    }
  }, 20_000);
});
