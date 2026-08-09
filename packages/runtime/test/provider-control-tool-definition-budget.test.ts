import { describe, expect, it } from "vitest";

import { createAgentMilestoneTool } from "../src/agent-milestone-tool.js";
import { createOperatorDecisionTool } from "../src/operator-decision-tool.js";

const MAX_CONTROL_TOOL_DEFINITION_BYTES = 2 * 1024;

describe("Provider control tool definition budget", () => {
  it("keeps decision and milestone definitions within two KiB", () => {
    const options = {
      store: undefined as never,
      threadId: "thread_control_schema_budget",
      runId: "run_control_schema_budget",
    };
    const tools = [
      createOperatorDecisionTool(options),
      createAgentMilestoneTool(options),
    ];
    const bytes = tools.reduce(
      (total, tool) =>
        total +
        Buffer.byteLength(
          JSON.stringify({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            constrainedSampling: tool.constrainedSampling ?? null,
          }),
          "utf8",
        ),
      0,
    );

    expect(bytes).toBeLessThanOrEqual(MAX_CONTROL_TOOL_DEFINITION_BYTES);
  });
});
