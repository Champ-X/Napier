import { describe, expect, it } from "vitest";

import {
  createGitCommitApplyTool,
  createGitCommitPreviewTool,
} from "../src/git-commit-tool.js";

const MAX_GIT_COMMIT_TOOL_DEFINITION_BYTES = 1.5 * 1024;

describe("Provider Git Commit tool definition budget", () => {
  it("keeps preview and apply definitions within one and a half KiB", () => {
    const context = {
      threadId: "thread_commit_schema_budget",
      scopeId: "run_commit_schema_budget",
    };
    const tools = [
      createGitCommitPreviewTool(undefined as never, context),
      createGitCommitApplyTool(undefined as never, context),
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

    expect(bytes).toBeLessThanOrEqual(MAX_GIT_COMMIT_TOOL_DEFINITION_BYTES);
  });

  it("keeps staged-tree, identity, one-use, CAS, merge, and denial guidance", () => {
    const context = {
      threadId: "thread_commit_schema_semantics",
      scopeId: "run_commit_schema_semantics",
    };
    const preview = createGitCommitPreviewTool(
      undefined as never,
      context,
    ).description;
    const apply = createGitCommitApplyTool(
      undefined as never,
      context,
    ).description;

    expect(preview).toContain("complete staged index");
    expect(preview).toContain("two-parent");
    expect(preview).toContain("fixed identity");
    expect(preview).toContain("one-use");
    expect(apply).toContain("CAS-update");
    expect(apply).toContain("merge");
    expect(apply).toContain("Hooks/signing");
    expect(apply).toContain("history rewrite");
  });
});
