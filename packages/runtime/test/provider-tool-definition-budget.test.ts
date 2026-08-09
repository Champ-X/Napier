import { describe, expect, it } from "vitest";

import { createBrowserTool } from "../src/browser-tool.js";
import { createDataFrameTool } from "../src/data-frame-tool.js";
import { createSqliteQueryTool } from "../src/sqlite-query-tool.js";

const MAX_HEAVY_TOOL_DEFINITION_BYTES = 10 * 1024;

describe("Provider tool definition budget", () => {
  it("keeps the three heaviest default definitions within ten KiB", () => {
    const owner = {
      threadId: "thread_schema_budget",
      runId: "run_schema_budget",
    };
    const tools = [
      createSqliteQueryTool("/workspace"),
      createDataFrameTool("/workspace"),
      createBrowserTool(undefined as never, owner, { readOnly: true }),
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

    expect(bytes).toBeLessThanOrEqual(MAX_HEAVY_TOOL_DEFINITION_BYTES);
  });
});
