import { describe, expect, it } from "vitest";

import { createDataFrameTool } from "../src/data-frame-tool.js";

const MAX_DATA_FRAME_TOOL_DEFINITION_BYTES = 2.5 * 1024;

describe("Provider DataFrame tool definition budget", () => {
  it("keeps the DataFrame definition within two and a half KiB", () => {
    const tool = createDataFrameTool("/workspace");
    const bytes = Buffer.byteLength(
      JSON.stringify({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        constrainedSampling: tool.constrainedSampling ?? null,
      }),
      "utf8",
    );

    expect(bytes).toBeLessThanOrEqual(MAX_DATA_FRAME_TOOL_DEFINITION_BYTES);
  });

  it("keeps hash binding, operation fields, casts, and no-code guidance", () => {
    const description = createDataFrameTool("/workspace").description;

    expect(description).toContain("inspect_data");
    expect(description).toContain("sourceSha256");
    expect(description).toContain("cast(column,dataType,outputColumn?)");
    expect(description).toContain("filter(column,operator,value?)");
    expect(description).toContain("select(columns)");
    expect(description).toContain("sort(columns)");
    expect(description).toContain("direction asc|desc");
    expect(description).toContain("group(by,aggregations)");
    expect(description).toContain("operation count|sum|mean|min|max");
    expect(description).toContain("column?,as");
    expect(description).toContain("limit(count)");
    expect(description).toContain("No expressions/code/I/O/network");
    expect(description).toContain("no implicit numeric coercion");
  });
});
