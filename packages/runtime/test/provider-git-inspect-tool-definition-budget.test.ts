import { describe, expect, it } from "vitest";

import { createGitInspectTool } from "../src/git-inspect-tool.js";

const MAX_GIT_INSPECT_TOOL_DEFINITION_BYTES = 2 * 1024;

describe("Provider Git Inspect tool definition budget", () => {
  it("keeps the Git Inspect definition within two KiB", () => {
    const tool = createGitInspectTool({
      workspaceRoot: "/workspace",
      sandbox: undefined as never,
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

    expect(bytes).toBeLessThanOrEqual(MAX_GIT_INSPECT_TOOL_DEFINITION_BYTES);
  });

  it("keeps read-only, conflict, denial, untrusted-data, and durable guidance", () => {
    const tool = createGitInspectTool({
      workspaceRoot: "/workspace",
      sandbox: undefined as never,
    });

    expect(tool.description).toContain("read-only");
    expect(tool.description).toContain("path or paths");
    expect(tool.description).toContain("1-4");
    expect(tool.description).toContain("apply_patch");
    expect(tool.description).toContain("untrusted");
    expect(tool.description).toContain("denied");
    expect(tool.description).toContain("counts/hashes");
  });
});
