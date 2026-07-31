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

describe("Provider tool schema compatibility", () => {
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
    ];

    for (const tool of tools) {
      const schema = tool.parameters as Record<string, unknown>;
      expect(schema, tool.name).toEqual(
        expect.objectContaining({
          type: "object",
          anyOf: expect.any(Array),
        }),
      );
    }
  });
});
