import { describe, expect, it } from "vitest";

import { createPlanTools } from "../src/plan-tools.js";

const MAX_PLAN_TOOL_DEFINITION_BYTES = 4.5 * 1024;

describe("Provider plan tool definition budget", () => {
  it("keeps the four plan definitions within four and a half KiB", () => {
    const tools = createPlanTools(
      {
        getAgent: () => ({
          model: { provider: "napier", id: "demo" },
          thinkingLevel: "medium",
        }),
      } as never,
      {
        agentId: "agent_plan_schema_budget",
        threadId: "thread_plan_schema_budget",
      } as never,
    );
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

    expect(bytes).toBeLessThanOrEqual(MAX_PLAN_TOOL_DEFINITION_BYTES);
  });
});
