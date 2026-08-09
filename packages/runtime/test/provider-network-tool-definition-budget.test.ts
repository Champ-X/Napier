import { describe, expect, it } from "vitest";

import { createWebFetchTool } from "../src/web-fetch-tool.js";
import { createWebSearchTool } from "../src/web-search-tool.js";

const MAX_NETWORK_TOOL_DEFINITION_BYTES = 3 * 1024;

describe("Provider network tool definition budget", () => {
  it("keeps default Search and Fetch definitions within three KiB", () => {
    const owner = {
      threadId: "thread_network_schema_budget",
      runId: "run_network_schema_budget",
    };
    const tools = [
      createWebSearchTool(undefined as never),
      createWebFetchTool(undefined as never, owner),
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

    expect(bytes).toBeLessThanOrEqual(MAX_NETWORK_TOOL_DEFINITION_BYTES);
  });
});
