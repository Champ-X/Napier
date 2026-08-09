import { describe, expect, it } from "vitest";

import { createWorkspaceTools } from "../src/tools.js";

const MAX_WORKSPACE_TOOL_DEFINITION_BYTES = 3 * 1024;

describe("Provider workspace tool definition budget", () => {
  it("keeps the seven read-only workspace definitions within three KiB", () => {
    const tools = createWorkspaceTools("/workspace");
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

    expect(bytes).toBeLessThanOrEqual(MAX_WORKSPACE_TOOL_DEFINITION_BYTES);
  });

  it("keeps path, range, and symbol preconditions in the merged guidance", () => {
    const descriptions = Object.fromEntries(
      createWorkspaceTools("/workspace").map((tool) => [
        tool.name,
        tool.description,
      ]),
    );

    expect(descriptions["list_files"]).toContain("workspace-relative");
    expect(descriptions["list_files"]).toContain("default '.'");
    expect(descriptions["read_file"]).toContain("1-based line range");
    expect(descriptions["search_files"]).toContain("default '.'");
    expect(descriptions["list_symbols"]).toContain("workspace-relative");
    expect(descriptions["inspect_data"]).toContain("JSONL");
    expect(descriptions["inspect_code"]).toContain("TypeScript");
    expect(descriptions["read_symbol"]).toContain("1-based symbol line");
    expect(descriptions["read_symbol"]).toContain("lineSha256");
  });
});
