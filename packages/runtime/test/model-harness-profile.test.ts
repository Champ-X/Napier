import { Type } from "typebox";
import {
  fauxProvider,
  type Context,
  type Message,
  type Tool,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import { canonicalJson, sha256 } from "../src/ed25519.js";
import {
  prepareModelHarnessCall,
  resolveModelHarnessProfile,
} from "../src/model-harness-profile.js";

const TOOL_NAMES = [
  "request_operator_decision", "create_plan", "update_plan_step",
  "record_run_milestone", "skill_load", "mcp_schema_search", "delegate_task",
  "list_files", "read_file", "search_files", "inspect_code", "read_symbol",
  "list_symbols", "apply_patch", "verify_workspace", "run_command",
  "lsp_diagnostics", "lsp_symbols", "lsp_definition", "lsp_references",
  "ast_query", "ast_edit_preview", "lsp_rename", "lsp_rename_apply",
  "lsp_code_actions", "lsp_code_action_apply", "workspace_file_preview",
  "workspace_file_apply", "workspace_process", "node_debugger", "git_inspect",
  "git_stage_preview", "git_stage_apply", "git_review_preview", "git_review_apply",
  "git_commit_preview", "git_commit_apply", "browser", "web_search", "web_fetch",
  "research_source", "inspect_data", "data_frame", "sqlite_query", "python_kernel",
];

describe("model-aware Harness profile", () => {
  it("selects deterministic model-family policies", () => {
    expect(profile("anthropic-messages")).toEqual(
      expect.objectContaining({ family: "anthropic", promptDialect: "xml-guided", maxActiveTools: 32 }),
    );
    expect(profile("openai-responses")).toEqual(
      expect.objectContaining({ family: "openai", promptDialect: "instruction-led", maxActiveTools: 28 }),
    );
    expect(profile("google-generative-ai")).toEqual(
      expect.objectContaining({ family: "google", maxActiveTools: 24 }),
    );
    expect(profile("custom-api")).toEqual(
      expect.objectContaining({ family: "generic", promptDialect: "compact", maxActiveTools: 20 }),
    );
  });

  it("compiles a focused coding tool surface and records the saved schema bytes", () => {
    const prepared = prepareModelHarnessCall({
      model: fauxProvider({ provider: "openai", api: "openai-responses" }).getModel(),
      context: context("Implement the bug fix, run tests, and verify the repository."),
      options: {},
      attempt: 1,
    });

    expect(prepared.receipt).toEqual(
      expect.objectContaining({
        family: "openai",
        intents: ["coding"],
        toolSurface: "focused",
        configuredToolCount: TOOL_NAMES.length,
        activeToolCount: 28,
        maxRetries: 2,
        maxRetriesSource: "harness",
      }),
    );
    expect(prepared.receipt.activeToolNames).toEqual(
      expect.arrayContaining(["read_file", "apply_patch", "verify_workspace", "run_command"]),
    );
    expect(prepared.receipt.savedToolDefinitionBytes).toBeGreaterThan(0);
    expect(prepared.context.systemPrompt).toBe("Base prompt");
    expect(prepared.options).toEqual(
      expect.objectContaining({ maxRetries: 2, maxRetryDelayMs: 30_000 }),
    );
    const { contentSha256, ...content } = prepared.receipt;
    expect(contentSha256).toBe(sha256(canonicalJson(content)));
  });

  it("preserves caller retry authority and keeps tools already used in the task", () => {
    const messages: Message[] = [
      { role: "user", content: "Continue.", timestamp: 1 },
      {
        role: "toolResult",
        toolCallId: "call_git",
        toolName: "git_commit_apply",
        content: [{ type: "text", text: "commit created" }],
        isError: false,
        timestamp: 2,
      },
    ];
    const prepared = prepareModelHarnessCall({
      model: fauxProvider({ provider: "generic" }).getModel(),
      context: { messages, tools: tools() },
      options: { maxRetries: 4, maxRetryDelayMs: 5_000 },
      attempt: 2,
    });

    expect(prepared.receipt.activeToolNames).toContain("git_commit_apply");
    expect(prepared.receipt.activeToolCount).toBe(20);
    expect(prepared.receipt).toEqual(
      expect.objectContaining({
        attempt: 2,
        maxRetries: 4,
        maxRetriesSource: "caller",
        maxRetryDelayMs: 5_000,
        maxRetryDelayMsSource: "caller",
      }),
    );
  });
});

function profile(api: string) {
  return resolveModelHarnessProfile({ api });
}

function context(prompt: string): Context {
  return { systemPrompt: "Base prompt", messages: [{ role: "user", content: prompt, timestamp: 1 }], tools: tools() };
}

function tools(): Tool[] {
  return TOOL_NAMES.map((name) => ({ name, description: `Use ${name}.`, parameters: Type.Object({}) }));
}
