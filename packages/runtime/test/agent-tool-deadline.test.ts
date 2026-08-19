import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentRuntime } from "../src/agent-runtime.js";
import {
  MCP_SCHEMA_SEARCH_TOOL_NAME,
  McpExtensionManager,
} from "../src/mcp.js";
import { ModelRegistry } from "../src/models.js";
import { LocalStore } from "../src/store.js";

const roots: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Agent tool deadline", () => {
  it("finalizes when an approved MCP tool ignores abort through grace", async () => {
    vi.useFakeTimers();
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-agent-tool-deadline-"),
    );
    roots.push(root);
    const store = new LocalStore({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    });
    await store.initialize();
    const seededAgent = store.listAgents()[0]!;
    const agent = await store.updateAgent(seededAgent.id, {
      toolPolicy: "observe",
      enabledTools: ["read_file"],
      enabledSkills: [],
      enabledSubagents: [],
    });
    const thread = await store.createThread({
      title: "MCP deadline",
      agentId: agent.id,
    });
    let extension = await store.createMcpExtension({
      name: "Slow service",
      transport: {
        type: "streamable_http",
        url: "https://example.com/mcp",
      },
      requestedCapabilities: ["external.read"],
    });
    extension = await store.reviewExtension(extension.id, {
      action: "approve",
    });
    const toolStarted = deferred<void>();
    const extensionManager = new McpExtensionManager({
      store,
      createClient: async () => ({
        initialize: async () => undefined,
        listTools: async () => ({
          tools: [
            {
              name: "slow",
              description: "Never settles.",
              inputSchema: { type: "object", properties: {} },
            },
          ],
        }),
        callTool: async () => {
          toolStarted.resolve();
          return new Promise(() => undefined);
        },
        close: async () => undefined,
      }),
    });
    extension = await extensionManager.connect(extension.id);
    extension = await store.reviewMcpTool(extension.id, "slow", {
      action: "approve",
      effect: "read",
      routingHint: "Use for the slow deadline fixture.",
    });
    await store.setExtensionEnabled(extension.id, agent.id, true);

    const provider = fauxProvider({ provider: "tool-deadline-provider" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall(MCP_SCHEMA_SEARCH_TOOL_NAME, { query: "slow" }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxToolCall("mcp__slow_service__slow", {}), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("THIS_TURN_MUST_NOT_RUN"),
    ]);
    const registry = new ModelRegistry();
    registry.registerProvider(provider.provider);
    registry.toolDeadlinePolicy = {
      timeoutMs: 100,
      settlementGraceMs: 50,
    };
    const runtime = new AgentRuntime(store, registry, extensionManager);

    const pending = runtime.runPrompt({
      threadId: thread.id,
      text: "Invoke the approved slow service.",
      model: { provider: "tool-deadline-provider", id: "faux-1" },
    });
    await toolStarted.promise;
    await vi.advanceTimersByTimeAsync(150);
    const run = await pending;

    expect(run).toEqual(
      expect.objectContaining({
        status: "failed",
        outcome: "paused_budget",
      }),
    );
    expect(provider.state.callCount).toBe(2);
    const events = await store.listEvents(thread.id);
    expect(
      events.find((event) => event.type === "tool.deadline.exceeded")?.payload,
    ).toEqual(
      expect.objectContaining({
        toolName: "mcp__slow_service__slow",
        reason: "deadline_exceeded",
        effect: "unknown",
        state: "started_unknown",
        timeoutMs: 100,
        graceMs: 50,
      }),
    );
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "tool.deadline.exceeded",
        "run.settlement.recorded",
        "run.settlement.checkpoint",
        "run.failed",
      ]),
    );
    expect(JSON.stringify(events)).not.toContain("THIS_TURN_MUST_NOT_RUN");
    expect(store.getThread(thread.id).status).toBe("idle");
    store.close();
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
