import { describe, expect, it } from "vitest";

import { createWorkspacePatchTool } from "../src/workspace-patch-tool.js";

const MAX_PATCH_TOOL_DEFINITION_BYTES = 2.25 * 1024;

describe("Provider Patch tool definition budget", () => {
  it("keeps the Patch definition within two and a quarter KiB", () => {
    const tool = createWorkspacePatchTool({
      workspaceRoot: "/workspace",
      dataRoot: "/data",
      applyPatch: undefined as never,
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

    expect(bytes).toBeLessThanOrEqual(MAX_PATCH_TOOL_DEFINITION_BYTES);
  });

  it("keeps create, CAS, anchored edit, deletion, and verification guidance", () => {
    const tool = createWorkspacePatchTool({
      workspaceRoot: "/workspace",
      dataRoot: "/data",
      applyPatch: undefined as never,
    });

    expect(tool.description).toContain("create");
    expect(tool.description).toContain("expectedSha256");
    expect(tool.description).toContain("oldText");
    expect(tool.description).toContain("anchorSha256");
    expect(tool.description).toContain("rangeSha256");
    expect(tool.description).toContain("empty newText");
    expect(tool.description).toContain("parent directories");
    expect(tool.description).toContain("diagnostics");
    expect(tool.description).toContain("tests");
  });
});
