import { describe, expect, it } from "vitest";

import { createBrowserTool } from "../src/browser-tool.js";
import { createJavascriptKernelTool } from "../src/javascript-kernel-tool.js";
import { createNodeDebuggerTool } from "../src/node-debugger-tool.js";
import { createPythonKernelTool } from "../src/python-kernel-tool.js";
import { createResearchSourceTool } from "../src/research-source-tool.js";
import { createSqliteQueryTool } from "../src/sqlite-query-tool.js";
import { createTypescriptAstTools } from "../src/typescript-ast-tool.js";
import { createWorkspaceFilePreviewTool } from "../src/workspace-file-tools.js";
import { createWorkspaceProcessTool } from "../src/workspace-process-tool.js";
import { createSubagentWorktreeFileTool } from "../src/subagent-worktree-file-tool.js";
import { createSkillLoadTool } from "../src/skill-load-tool.js";
import { createSkillAccessState } from "../src/skill-access-state.js";
import { createSkillResourceTool } from "../src/skill-resource-tool.js";

describe("Provider tool schema compatibility", () => {
  it("publishes the exact provider-safe skill_load schema", () => {
    const tool = createSkillLoadTool(undefined as never);
    expect(tool.name).toBe("skill_load");
    expect(tool.parameters).toEqual(
      expect.objectContaining({
        type: "object",
        additionalProperties: false,
        required: ["name"],
        properties: {
          name: expect.objectContaining({
            type: "string",
            minLength: 1,
            maxLength: 64,
            pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
          }),
        },
      }),
    );
  });

  it("publishes the exact provider-safe skill_resource schema", () => {
    const tool = createSkillResourceTool(
      undefined as never,
      createSkillAccessState(),
    );
    expect(tool.name).toBe("skill_resource");
    expect(tool.parameters).toEqual(
      expect.objectContaining({
        type: "object",
        additionalProperties: false,
        required: ["name", "path"],
        properties: {
          name: expect.objectContaining({
            type: "string",
            minLength: 1,
            maxLength: 64,
            pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
          }),
          path: expect.objectContaining({
            type: "string",
            minLength: 3,
            maxLength: 240,
          }),
        },
      }),
    );
  });

  it("publishes object-rooted JSON Schemas for action-union tools", () => {
    const owner = { threadId: "thread_schema", runId: "run_schema" };
    const astEdit = createTypescriptAstTools("/workspace").find(
      (tool) => tool.name === "ast_edit_preview",
    )!;
    const tools = [
      createBrowserTool(undefined as never, owner),
      createJavascriptKernelTool(undefined as never, owner),
      createNodeDebuggerTool(undefined as never, owner),
      createPythonKernelTool(undefined as never, owner),
      createResearchSourceTool(undefined as never, owner),
      createSqliteQueryTool("/workspace"),
      astEdit,
      createWorkspaceFilePreviewTool(undefined as never, owner),
      createWorkspaceProcessTool(undefined as never, owner),
      createSubagentWorktreeFileTool(
        {
          taskId: "task_schema123",
          root: "/workspace/candidate",
          sourceRoot: "/workspace",
          sourceSnapshotSha256: "0".repeat(64),
          sourceFileCount: 0,
          sourceBytes: 0,
          writePaths: ["src/value.ts"],
          writeScopeSetSha256: "1".repeat(64),
        },
        (operation) => operation(),
      ),
    ];

    const compactObjectTools = new Set([
      "sqlite_query",
      "ast_edit_preview",
      "workspace_file_preview",
      "candidate_file",
    ]);
    for (const tool of tools) {
      const schema = tool.parameters as Record<string, unknown>;
      if (compactObjectTools.has(tool.name)) {
        expect(schema, tool.name).toEqual(
          expect.objectContaining({
            type: "object",
            additionalProperties: false,
            properties: expect.any(Object),
          }),
        );
        expect(schema, tool.name).not.toHaveProperty("anyOf");
      } else {
        expect(schema, tool.name).toEqual(
          expect.objectContaining({
            type: "object",
            anyOf: expect.any(Array),
          }),
        );
      }
    }
  });
});
