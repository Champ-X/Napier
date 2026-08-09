import { describe, expect, it } from "vitest";

import { createNodeDebuggerTool } from "../src/node-debugger-tool.js";

const MAX_DEBUGGER_TOOL_DEFINITION_BYTES = 3.5 * 1024;

describe("Provider Debugger tool definition budget", () => {
  it("keeps the Node Debugger definition within three and a half KiB", () => {
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
});
