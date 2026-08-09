import { describe, expect, it } from "vitest";

import {
  createGitStageApplyTool,
  createGitStagePreviewTool,
} from "../src/git-stage-tool.js";

const MAX_GIT_STAGE_TOOL_DEFINITION_BYTES = 1.75 * 1024;

describe("Provider Git Stage tool definition budget", () => {
  it("keeps preview and apply definitions within one and three quarters KiB", () => {
    const context = {
      threadId: "thread_stage_schema_budget",
      scopeId: "run_stage_schema_budget",
    };
    const tools = [
      createGitStagePreviewTool(undefined as never, context),
      createGitStageApplyTool(undefined as never, context),
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

    expect(bytes).toBeLessThanOrEqual(MAX_GIT_STAGE_TOOL_DEFINITION_BYTES);
  });

  it("keeps path, hunk, private-index, one-use, CAS, and no-ref guidance", () => {
    const context = {
      threadId: "thread_stage_schema_semantics",
      scopeId: "run_stage_schema_semantics",
    };
    const preview = createGitStagePreviewTool(
      undefined as never,
      context,
    ).description;
    const apply = createGitStageApplyTool(
      undefined as never,
      context,
    ).description;

    expect(preview).toContain("path XOR paths");
    expect(preview).toContain("1-16");
    expect(preview).toContain("hunkIndexes");
    expect(preview).toContain("private index");
    expect(preview).toContain("untrusted");
    expect(apply).toContain("one-use");
    expect(apply).toContain("rechecks");
    expect(apply).toContain("index.lock");
    expect(apply).toContain("refs");
    expect(apply).toContain("worktree");
  });
});
