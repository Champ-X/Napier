import { describe, expect, it } from "vitest";

import { createLspSymbolsTool } from "../src/lsp-symbols-tool.js";
import { createTypescriptAstTools } from "../src/typescript-ast-tool.js";
import { formatWorkspaceToolGuidance } from "../src/workspace-tool-guidance.js";

describe("workspace tool guidance", () => {
  it("does not recommend unavailable heuristic tools for LSP symbols alone", () => {
    const guidance = formatWorkspaceToolGuidance([
      createLspSymbolsTool({
        workspaceRoot: "/workspace",
        sandbox: {
          id: "guidance-no-launch",
          async launch() {
            throw new Error("launch must not be reached");
          },
        },
      }),
    ]);

    expect(guidance).toContain(
      "Use lsp_symbols for the real TypeScript or JavaScript semantic outline",
    );
    expect(guidance).not.toContain(
      "use list_symbols, inspect_code, and read_symbol",
    );
  });

  it("requires AST previews to return through CAS and verification", () => {
    const guidance = formatWorkspaceToolGuidance([
      ...createTypescriptAstTools("/workspace"),
    ]);

    expect(guidance).toContain(
      "Use ast_query for exact TypeScript or JavaScript syntax nodes",
    );
    expect(guidance).toContain("ast_edit_preview never writes");
    expect(guidance).toContain("Apply it through apply_patch");
  });
});
