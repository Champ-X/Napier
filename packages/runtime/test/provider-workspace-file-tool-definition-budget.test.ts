import { describe, expect, it, vi } from "vitest";

import {
  createWorkspaceFileApplyTool,
  createWorkspaceFilePreviewTool,
} from "../src/workspace-file-tools.js";

const MAX_WORKSPACE_FILE_TOOL_DEFINITION_BYTES = 1.75 * 1024;

describe("Provider Workspace File tool definition budget", () => {
  it("keeps preview and apply definitions within one and three quarters KiB", () => {
    const tools = [
      createWorkspaceFilePreviewTool(undefined as never, {
        threadId: "thread_file_schema_budget",
        runId: "run_file_schema_budget",
      }),
      createWorkspaceFileApplyTool(undefined as never, {
        threadId: "thread_file_schema_budget",
        runId: "run_file_schema_budget",
      }),
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

    expect(bytes).toBeLessThanOrEqual(MAX_WORKSPACE_FILE_TOOL_DEFINITION_BYTES);
  });

  it("keeps preview, one-use, stale, occupied, and reversible guidance", () => {
    const preview = createWorkspaceFilePreviewTool(undefined as never, {
      threadId: "thread_file_schema_semantics",
      runId: "run_file_schema_semantics",
    });
    const apply = createWorkspaceFileApplyTool(undefined as never, {
      threadId: "thread_file_schema_semantics",
      runId: "run_file_schema_semantics",
    });

    expect(preview.description).toContain("create_directory");
    expect(preview.description).toContain("move");
    expect(preview.description).toContain("trash");
    expect(preview.description).toContain("restore");
    expect(preview.description).toContain("list_trash");
    expect(apply.description).toContain("one-use");
    expect(apply.description).toContain("stale");
    expect(apply.description).toContain("occupied");
    expect(apply.description).toContain("permanent deletion");
  });

  it("rejects operation-mismatched preview fields before manager access", async () => {
    const preview = vi.fn();
    const listTrash = vi.fn();
    const tool = createWorkspaceFilePreviewTool(
      { preview, listTrash } as never,
      {
        threadId: "thread_file_schema_fields",
        runId: "run_file_schema_fields",
      },
    );

    await expect(
      tool.execute("call-list-extra", {
        action: "list_trash",
        path: "unexpected",
      } as never),
    ).rejects.toThrow("fields do not match operation");
    await expect(
      tool.execute("call-move-missing", {
        action: "preview",
        operation: "move",
        sourcePath: "source.txt",
      } as never),
    ).rejects.toThrow("fields do not match operation");
    await expect(
      tool.execute("call-trash-parents", {
        action: "preview",
        operation: "trash",
        path: "source.txt",
        createParentDirectories: true,
      } as never),
    ).rejects.toThrow("fields do not match operation");
    expect(preview).not.toHaveBeenCalled();
    expect(listTrash).not.toHaveBeenCalled();
  });
});
