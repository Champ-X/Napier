import { expect, it, vi } from "vitest";
import { createWorkspacePatchTool } from "../src/workspace-patch-tool.js";
import { withWorkspaceEditReferences } from "../src/workspace-edit-reference-tools.js";
import { WorkspacePatchInputError } from "../src/workspace-patch-input-error.js";

const digest = "a".repeat(64);
it.each([
  { operation: "create", expectedSha256: digest, content: "PRIVATE_CONTENT" },
  { operation: "replace", expectedSha256: digest, content: "PRIVATE_CONTENT" },
  {
    operation: "hashline_replace",
    expectedSha256: digest,
    edits: [{ oldText: "PRIVATE_CONTENT", newText: "replacement" }],
  },
  {
    operation: "hashrange_replace",
    expectedSha256: digest,
    edits: [{ startLine: 1, endLine: 2, newText: "PRIVATE_CONTENT" }],
  },
])(
  "rejects $operation fields before effects and reports argument repair instead of stale-snapshot recovery",
  async (input) => {
    const beforeWrite = vi.fn(),
      applyPatch = vi.fn(),
      supports = vi.fn();
    const tool = createWorkspacePatchTool({
      workspaceRoot: "/unused-workspace",
      dataRoot: "/unused-data",
      beforeWrite,
      applyPatch,
      observer: { supports, observeBefore: vi.fn(), observeAfter: vi.fn() },
    });
    const decorated = withWorkspaceEditReferences([tool], {
      unifiedDiff: true,
    })[0]!;
    let error: unknown;
    try {
      await decorated.execute("invalid-shape", {
        ...input,
        path: "PRIVATE_PATH",
      } as never);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(WorkspacePatchInputError);
    const message = (error as Error).message;
    expect(message).toContain(`${input.operation} requires`);
    expect(message).toContain("No file write was attempted");
    expect(message).not.toContain("PRIVATE_");
    expect(message).not.toContain("read_then_rebuild_edit");
    expect(beforeWrite).not.toHaveBeenCalled();
    expect(applyPatch).not.toHaveBeenCalled();
    expect(supports).not.toHaveBeenCalled();
  },
);
