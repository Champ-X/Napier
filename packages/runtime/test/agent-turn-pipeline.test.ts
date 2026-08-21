import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { describe, expect, it, vi } from "vitest";

import { createAgentPromptBuilder } from "../src/agent-prompt-builder.js";
import {
  AgentTurnPipeline,
  DEFAULT_AGENT_TURN_POLICY_ADAPTER,
  DEFAULT_AGENT_TURN_PROMPT_ADAPTER,
} from "../src/agent-turn-pipeline.js";
import { AgentTurnPipelineHost } from "../src/agent-turn-pipeline-host.js";

describe("Agent Turn Pipeline", () => {
  it("accepts only a deterministic subset or reorder of candidate tools", async () => {
    const first = tool("first");
    const second = tool("second");
    const deferred = tool("deferred");
    const pipeline = pipelineWithToolSelection((candidates) => ({
      immediate: [candidates.immediate[1]!],
      deferred: [candidates.deferred[0]!],
    }));

    const selection = await pipeline.compileTools({
      immediate: [first, second],
      deferred: [deferred],
    });

    expect(selection.immediate).toEqual([second]);
    expect(selection.deferred).toEqual([deferred]);
    expect(selection.receipt).toEqual({
      candidateToolSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      activeToolSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(selection.receipt.activeToolSetSha256).not.toBe(
      selection.receipt.candidateToolSetSha256,
    );
  });

  it.each([
    {
      name: "new tool",
      select: () => ({ immediate: [tool("injected")], deferred: [] }),
      error: "non-candidate immediate tool",
    },
    {
      name: "replacement object",
      select: (candidates: { immediate: readonly AgentTool[] }) => ({
        immediate: [{ ...candidates.immediate[0]! }],
        deferred: [],
      }),
      error: "non-candidate immediate tool",
    },
    {
      name: "duplicate name",
      select: (candidates: { immediate: readonly AgentTool[] }) => ({
        immediate: [candidates.immediate[0]!, candidates.immediate[0]!],
        deferred: [],
      }),
      error: "active tool name is duplicated",
    },
    {
      name: "cross-group move",
      select: (candidates: { deferred: readonly AgentTool[] }) => ({
        immediate: [candidates.deferred[0]!],
        deferred: [],
      }),
      error: "non-candidate immediate tool",
    },
  ])("fails closed for a $name", async ({ select, error }) => {
    const pipeline = pipelineWithToolSelection(select);
    await expect(
      pipeline.compileTools({
        immediate: [tool("candidate")],
        deferred: [tool("deferred")],
      }),
    ).rejects.toThrow(error);
  });

  it("fails closed when a tool adapter mutates a candidate object", async () => {
    const candidate = tool("candidate");
    const pipeline = pipelineWithToolSelection((candidates) => {
      candidates.immediate[0]!.label = "Mutated";
      return candidates;
    });

    await expect(
      pipeline.compileTools({ immediate: [candidate], deferred: [] }),
    ).rejects.toThrow("mutated a candidate tool");
  });

  it("rejects prompt builders that do not return a valid compiled artifact", () => {
    const pipeline = new AgentTurnPipeline({
      prompt: {
        id: "test.prompt.invalid",
        create: (() => () => ({ systemPrompt: "forged" })) as never,
      },
      tool: { id: "test.tool.default", select: (candidates) => candidates },
      policy: DEFAULT_AGENT_TURN_POLICY_ADAPTER,
    });
    const builder = pipeline.createPromptBuilder(
      {
        resolvedSystemPrompt: "",
        skillCatalog: "",
        effectiveCapabilities: "",
        workspaceToolGuidance: "",
        planToolGuidance: "",
        sourceContinuityGuidance: "",
        importedLedgerBoundary: "",
        checkpoint: "",
        memory: "",
      },
      () => "",
    );

    expect(() =>
      builder({} as never, {} as never, {} as never, undefined),
    ).toThrow();
  });

  it("fails closed when a prompt adapter does not return a builder", () => {
    const pipeline = new AgentTurnPipeline({
      prompt: {
        id: "test.prompt.missing-builder",
        create: (() => undefined) as never,
      },
      tool: { id: "test.tool.default", select: (candidates) => candidates },
      policy: DEFAULT_AGENT_TURN_POLICY_ADAPTER,
    });
    expect(() => pipeline.createPromptBuilder({} as never, () => "")).toThrow(
      "returned an invalid builder",
    );
  });

  it("fails closed when an additional policy tries to return allow", async () => {
    const pipeline = new AgentTurnPipeline({
      prompt: DEFAULT_AGENT_TURN_PROMPT_ADAPTER,
      tool: { id: "test.tool.default", select: (candidates) => candidates },
      policy: {
        id: "test.policy.allow",
        preflight: () => ({ block: false, reason: "allow" }),
      },
    });
    const input = {
      store: {} as never,
      run: { id: "run_test0000", threadId: "thread_test0000" },
      profile: { id: "agent_test0000", toolPolicy: "observe" },
      confirmations: {} as never,
      browserPauses: {} as never,
      browserConfirmation: {} as never,
      restrictedReadOnlyExecution: false,
      toolCall: { id: "call_test0000", name: "delegate_task" },
      args: {},
    } as Parameters<AgentTurnPipeline["preflightPolicy"]>[0];

    await expect(pipeline.preflightPolicy(input)).rejects.toThrow(
      "may only add an explicit block",
    );
  });

  it("attaches one Kernel pipeline at a time and restores standalone behavior", () => {
    const host = new AgentTurnPipelineHost();
    const standalone = host.current();
    const attached = pipelineWithToolSelection((candidates) => candidates);
    const detach = host.attach(attached);

    expect(host.current()).toBe(attached);
    expect(() => host.attach(attached)).toThrow(
      "already has a Kernel Turn Pipeline",
    );
    detach();
    detach();
    expect(host.current()).toBe(standalone);
  });

  it("keeps default prompt construction byte-compatible", () => {
    const pipeline = new AgentTurnPipeline({
      prompt: DEFAULT_AGENT_TURN_PROMPT_ADAPTER,
      tool: { id: "test.tool.default", select: (candidates) => candidates },
      policy: DEFAULT_AGENT_TURN_POLICY_ADAPTER,
    });
    expect(pipeline.inspect()).toEqual(
      expect.objectContaining({
        promptAdapterId: "napier.prompt.default",
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(DEFAULT_AGENT_TURN_PROMPT_ADAPTER.create).toBe(
      createAgentPromptBuilder,
    );
  });
});

function pipelineWithToolSelection(
  select: (candidates: {
    immediate: readonly AgentTool[];
    deferred: readonly AgentTool[];
  }) =>
    | { immediate: readonly AgentTool[]; deferred: readonly AgentTool[] }
    | Promise<{
        immediate: readonly AgentTool[];
        deferred: readonly AgentTool[];
      }>,
) {
  return new AgentTurnPipeline({
    prompt: DEFAULT_AGENT_TURN_PROMPT_ADAPTER,
    tool: { id: "test.tool.selection", select },
    policy: DEFAULT_AGENT_TURN_POLICY_ADAPTER,
  });
}

function tool(name: string): AgentTool {
  return {
    name,
    label: name,
    description: `${name} fixture`,
    parameters: Type.Object({}),
    execute: vi.fn(async () => ({
      content: [{ type: "text", text: name }],
      details: {},
    })),
  };
}
