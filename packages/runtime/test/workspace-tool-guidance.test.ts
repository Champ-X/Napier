import type { AgentTool } from "@earendil-works/pi-agent-core";
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

  it("binds direct LSP rename application to one fresh preview", () => {
    const guidance = formatWorkspaceToolGuidance([
      { name: "lsp_rename" } as AgentTool,
      { name: "lsp_rename_apply" } as AgentTool,
      { name: "verify_workspace" } as AgentTool,
    ]);

    expect(guidance).toContain(
      "pass only its fresh one-use preview ID to lsp_rename_apply",
    );
    expect(guidance).toContain("rechecks every hash under locks");
    expect(guidance).toContain(
      "selects and runs bounded reverse-dependent TypeScript",
    );
    expect(guidance).toContain(
      "Never retry rolled-back or indeterminate results",
    );
  });

  it("binds one Code Action alternative to coordinated apply", () => {
    const guidance = formatWorkspaceToolGuidance([
      { name: "lsp_code_actions" } as AgentTool,
      { name: "lsp_code_action_apply" } as AgentTool,
      { name: "verify_workspace" } as AgentTool,
    ]);

    expect(guidance).toContain(
      "pass only the chosen action's fresh one-use preview ID",
    );
    expect(guidance).toContain("invalidates every sibling alternative");
    expect(guidance).toContain("denies every language-server command");
    expect(guidance).toContain(
      "selects and runs bounded reverse-dependent TypeScript",
    );
  });

  it("describes automatic write-linked tests without overstating coverage", () => {
    const guidance = formatWorkspaceToolGuidance([
      { name: "apply_patch" } as AgentTool,
      { name: "verify_workspace" } as AgentTool,
    ]);

    expect(guidance).toContain(
      "automatically select up to eight reverse-dependent tests",
    );
    expect(guidance).toContain("declared workspace package names");
    expect(guidance).toContain("selection_incomplete as unknown coverage");
    expect(guidance).toContain("Use verify_workspace for broader typecheck");
  });

  it("binds Git staging to one exact private-index preview", () => {
    const guidance = formatWorkspaceToolGuidance([
      { name: "git_inspect" } as AgentTool,
      { name: "git_stage_preview" } as AgentTool,
      { name: "git_stage_apply" } as AgentTool,
      { name: "git_commit_preview" } as AgentTool,
      { name: "git_commit_apply" } as AgentTool,
      { name: "git_branch_create_preview" } as AgentTool,
      { name: "git_branch_create_apply" } as AgentTool,
      { name: "git_branch_switch_preview" } as AgentTool,
      { name: "git_branch_switch_apply" } as AgentTool,
      { name: "git_review_preview" } as AgentTool,
      { name: "git_review_apply" } as AgentTool,
    ]);

    expect(guidance).toContain("exact working or staged hunks");
    expect(guidance).toContain("review its complete private-index patch");
    expect(guidance).toContain("strictly increasing 1-based hunkIndexes");
    expect(guidance).toContain("canonical 1-16 path atomic set");
    expect(guidance).toContain("execution-scoped preview ID");
    expect(guidance).toContain("never commits or changes refs/worktree");
    expect(guidance).toContain("exact commit SHA-1");
    expect(guidance).toContain("never runs hooks, signing, checkout");
    expect(guidance).toContain("bind one new local branch name");
    expect(guidance).toContain("does not switch HEAD");
    expect(guidance).toContain("existing local branch");
    expect(guidance).toContain("complete checkout patch");
    expect(guidance).toContain("source/target HEAD transaction");
    expect(guidance).toContain("complete bounded commit patch");
    expect(guidance).toContain("only fast-forwards the previewed target ref");
  });

  it("describes the restricted Python state boundary", () => {
    const guidance = formatWorkspaceToolGuidance([
      { name: "python_kernel" } as AgentTool,
    ]);

    expect(guidance).toContain(
      "Use python_kernel for multi-step pure Python calculations",
    );
    expect(guidance).toContain(
      "Imports, classes, async/yield, private or dunder access",
    );
  });

  it("describes the DAP session and live-only debug boundary", () => {
    const guidance = formatWorkspaceToolGuidance([
      { name: "node_debugger" } as AgentTool,
    ]);

    expect(guidance).toContain(
      "Use node_debugger to launch a real workspace JavaScript",
    );
    expect(guidance).toContain("programPath and sourceMapPath");
    expect(guidance).toContain("Evaluation rejects side effects");
    expect(guidance).toContain("source-map, or loaded-module drift");
  });

  it("requires exact Browser Source capture and claim-bound citations", () => {
    const guidance = formatWorkspaceToolGuidance([
      { name: "browser" } as AgentTool,
      { name: "research_source" } as AgentTool,
    ]);

    expect(guidance).toContain(
      "Use browser for multi-step interaction with a public website",
    );
    expect(guidance).toContain(
      "call research_source capture to freeze bounded visible text",
    );
    expect(guidance).toContain(
      "A citation token proves only the captured range-to-claim binding",
    );
    expect(guidance).toContain("capture disconfirming evidence");
    expect(guidance).toContain(
      "call research_source verify_report with its actual complete-file SHA-256",
    );
  });
});
