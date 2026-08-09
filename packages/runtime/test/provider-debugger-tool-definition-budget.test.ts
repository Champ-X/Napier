import { describe, expect, it, vi } from "vitest";

import { createNodeDebuggerTool } from "../src/node-debugger-tool.js";

const MAX_DEBUGGER_TOOL_DEFINITION_BYTES = 3 * 1024;

describe("Provider Debugger tool definition budget", () => {
  it("keeps the Node Debugger definition within three KiB", () => {
    const tool = createNodeDebuggerTool(undefined as never, {
      threadId: "thread_debugger_schema_budget",
      runId: "run_debugger_schema_budget",
    });
    const bytes = Buffer.byteLength(
      JSON.stringify({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        constrainedSampling: tool.constrainedSampling ?? null,
      }),
      "utf8",
    );

    expect(bytes).toBeLessThanOrEqual(MAX_DEBUGGER_TOOL_DEFINITION_BYTES);
  });

  it("keeps path, source-map, evaluation, timeout, and privacy guidance", () => {
    const tool = createNodeDebuggerTool(undefined as never, {
      threadId: "thread_debugger_schema_semantics",
      runId: "run_debugger_schema_semantics",
    });

    expect(tool.description).toContain("workspace-relative");
    expect(tool.description).toContain("programPath");
    expect(tool.description).toContain("sourceMapPath");
    expect(tool.description).toContain("throwOnSideEffect");
    expect(tool.description).toContain("timeoutMs");
    expect(tool.description).toContain("live-only");
  });

  it("rejects paused-session fields that do not match the action", async () => {
    const stackTrace = vi.fn();
    const scopes = vi.fn();
    const variables = vi.fn();
    const evaluate = vi.fn();
    const resume = vi.fn();
    const cancel = vi.fn();
    const tool = createNodeDebuggerTool(
      { stackTrace, scopes, variables, evaluate, resume, cancel } as never,
      {
        threadId: "thread_debugger_schema_controls",
        runId: "run_debugger_schema_controls",
      },
    );
    const processId = "process_12345678";

    await expect(
      tool.execute("call-scopes-missing", {
        action: "scopes",
        processId,
      } as never),
    ).rejects.toThrow("fields do not match action");
    await expect(
      tool.execute("call-evaluate-missing", {
        action: "evaluate",
        processId,
        frameId: 1,
      } as never),
    ).rejects.toThrow("fields do not match action");
    await expect(
      tool.execute("call-continue-extra", {
        action: "continue",
        processId,
        frameId: 1,
      } as never),
    ).rejects.toThrow("fields do not match action");
    expect(stackTrace).not.toHaveBeenCalled();
    expect(scopes).not.toHaveBeenCalled();
    expect(variables).not.toHaveBeenCalled();
    expect(evaluate).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });
});
