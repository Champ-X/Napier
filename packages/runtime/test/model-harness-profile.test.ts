import { Type } from "typebox";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type Context,
  type Message,
  type Tool,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import { canonicalJson, sha256 } from "../src/ed25519.js";
import {
  formatModelHarnessPrompt,
  prepareModelHarnessCall,
  resolveModelHarnessProfile,
  resolveModelHarnessResolution,
} from "../src/model-harness-profile.js";

const TOOL_NAMES = [
  "request_operator_decision",
  "create_plan",
  "update_plan_step",
  "record_run_milestone",
  "skill_load",
  "capability",
  "mcp_schema_search",
  "delegate_task",
  "list_files",
  "read_file",
  "search_files",
  "inspect_code",
  "read_symbol",
  "list_symbols",
  "apply_patch",
  "verify_workspace",
  "run_command",
  "lsp_diagnostics",
  "lsp_symbols",
  "lsp_definition",
  "lsp_references",
  "ast_query",
  "ast_edit_preview",
  "lsp_rename",
  "lsp_rename_apply",
  "lsp_code_actions",
  "lsp_code_action_apply",
  "workspace_file_preview",
  "workspace_file_apply",
  "workspace_process",
  "node_debugger",
  "git_inspect",
  "git_stage_preview",
  "git_stage_apply",
  "git_review_preview",
  "git_review_apply",
  "git_commit_preview",
  "git_commit_apply",
  "browser",
  "web_search",
  "web_fetch",
  "research_source",
  "inspect_data",
  "data_frame",
  "sqlite_query",
  "python_kernel",
];

describe("model-aware Harness profile", () => {
  it("selects deterministic model-family policies", () => {
    expect(profile("anthropic-messages")).toEqual(
      expect.objectContaining({
        family: "anthropic",
        promptDialect: "xml-guided",
        maxActiveTools: 32,
      }),
    );
    expect(profile("openai-responses")).toEqual(
      expect.objectContaining({
        family: "openai",
        promptDialect: "instruction-led",
        maxActiveTools: 28,
      }),
    );
    expect(profile("google-generative-ai")).toEqual(
      expect.objectContaining({ family: "google", maxActiveTools: 24 }),
    );
    expect(profile("custom-api")).toEqual(
      expect.objectContaining({
        family: "generic",
        promptDialect: "compact",
        maxActiveTools: 20,
      }),
    );
  });

  it("compiles a focused coding tool surface and records the saved schema bytes", () => {
    const prepared = prepareModelHarnessCall({
      model: fauxProvider({
        provider: "openai",
        api: "openai-responses",
      }).getModel(),
      context: context(
        "Implement the bug fix, run tests, and verify the repository.",
      ),
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
      expect.arrayContaining([
        "read_file",
        "apply_patch",
        "verify_workspace",
        "run_command",
      ]),
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

  it("keeps approved deferred MCP tools after schema activation", () => {
    const deferredTool = {
      name: "mcp__evidence_service__lookup",
      description: "Look up approved evidence.",
      parameters: Type.Object({ query: Type.String() }),
    };
    const prepared = prepareModelHarnessCall({
      model: fauxProvider({ provider: "generic" }).getModel(),
      context: {
        messages: [
          {
            role: "user",
            content: "Loaded for the next turn: mcp__evidence_service__lookup",
            timestamp: 1,
          },
        ],
        tools: [...tools(), deferredTool],
      },
      options: {},
      attempt: 1,
    });

    expect(prepared.receipt.activeToolCount).toBe(20);
    expect(prepared.receipt.activeToolNames).toContain(
      "mcp__evidence_service__lookup",
    );
    expect(prepared.receipt.activeToolNames).toContain("mcp_schema_search");
  });

  it("keeps a first-party tool activated by the Capability Catalog", () => {
    const prepared = prepareModelHarnessCall({
      model: fauxProvider({ provider: "generic" }).getModel(),
      context: {
        messages: [
          { role: "user", content: "Continue.", timestamp: 1 },
          {
            role: "toolResult",
            toolCallId: "call_catalog",
            toolName: "capability",
            content: [{ type: "text", text: "Activated a capability." }],
            addedToolNames: ["git_commit_apply"],
            isError: false,
            timestamp: 2,
          },
        ],
        tools: tools(),
      },
      options: {},
      attempt: 1,
    });

    expect(prepared.receipt.activeToolCount).toBe(20);
    expect(prepared.receipt.activeToolNames).toContain("capability");
    expect(prepared.receipt.activeToolNames).toContain("git_commit_apply");
  });

  it("bounds stale first-party catalog activations instead of failing before the provider call", () => {
    const prepared = prepareModelHarnessCall({
      model: fauxProvider({ provider: "generic" }).getModel(),
      context: {
        messages: [
          { role: "user", content: "Continue.", timestamp: 1 },
          {
            role: "toolResult",
            toolCallId: "call_catalog_root",
            toolName: "capability",
            content: [{ type: "text", text: "Catalog root listing." }],
            addedToolNames: TOOL_NAMES,
            isError: false,
            timestamp: 2,
          },
        ],
        tools: tools(),
      },
      options: {},
      attempt: 3,
    });

    expect(prepared.receipt.activeToolCount).toBe(20);
    expect(prepared.receipt.activeToolNames).toEqual(
      expect.arrayContaining(["capability", "read_file"]),
    );
  });

  it.each([
    [
      "OPENAI",
      "openai-responses",
      "gpt-5.4-2026-08-01",
      "openai-reasoning",
      "openai",
    ],
    [
      "Anthropic",
      "anthropic-messages",
      "claude-sonnet-4-5-20250929",
      "claude",
      "anthropic",
    ],
    [
      "GOOGLE-VERTEX",
      "google-vertex",
      "gemini-3.1-pro-preview",
      "gemini",
      "google",
    ],
    ["DeepSeek", "openai-completions", "deepseek-v4-pro", "deepseek", "openai"],
  ] as const)(
    "resolves %s/%s/%s to the %s model rule",
    (provider, api, id, matchedRuleId, family) => {
      const resolution = resolveModelHarnessResolution({
        model: specificModel(provider, api, id),
        messages: [
          { role: "user", content: "Implement and verify it.", timestamp: 1 },
        ],
        tools: tools(),
      });

      expect(resolution).toEqual(
        expect.objectContaining({
          family,
          matchedRuleId,
          policySource: "model_rule",
          taskPhase: "coding",
          maxActiveTools: 20,
          defaultMaxRetries: 1,
        }),
      );
      expect(formatModelHarnessPrompt(resolution)).toContain(
        `rule="${matchedRuleId}"`,
      );
    },
  );

  it("normalizes an OpenRouter provider alias and a namespaced model ID", () => {
    expect(
      resolveModelHarnessResolution({
        model: specificModel(
          "OpenRouter",
          "openai-completions",
          "deepseek/deepseek-v3.2-speciale",
        ),
        messages: [],
        tools: [],
      }),
    ).toEqual(expect.objectContaining({ matchedRuleId: "deepseek" }));
    expect(
      resolveModelHarnessResolution({
        model: specificModel(
          "OpenRouter",
          "openai-responses",
          "openai/gpt-5.4",
        ),
        messages: [],
        tools: [],
      }),
    ).toEqual(expect.objectContaining({ matchedRuleId: "openai-reasoning" }));
    expect(
      resolveModelHarnessResolution({
        model: specificModel(
          "amazon-bedrock",
          "bedrock-converse-stream",
          "anthropic.claude-3-7-sonnet-v1:0",
        ),
        messages: [],
        tools: [],
      }),
    ).toEqual(expect.objectContaining({ matchedRuleId: "claude" }));
  });

  it.each([
    ["Open the browser and navigate to the site.", "browser"],
    ["Research the latest sources and citations.", "research"],
    ["Analyze this CSV dataset with SQL.", "data"],
    ["Implement the code fix and run tests.", "coding"],
    ["Continue with the task.", "general"],
  ] as const)(
    "classifies the latest task phase for %s",
    (content, taskPhase) => {
      expect(
        resolveModelHarnessResolution({
          model: specificModel("unknown", "custom-api", "unknown-v1"),
          messages: [{ role: "user", content, timestamp: 1 }],
          tools: [],
        }).taskPhase,
      ).toBe(taskPhase);
    },
  );

  it("uses the latest non-empty user message and projects only available environment capabilities", () => {
    const resolution = resolveModelHarnessResolution({
      model: specificModel("unknown", "custom-api", "unknown-v1"),
      messages: [
        {
          role: "user",
          content: "Implement the repository fix.",
          timestamp: 1,
        },
        { role: "user", content: "   ", timestamp: 2 },
        {
          role: "user",
          content: "Now navigate the website page.",
          timestamp: 3,
        },
      ],
      tools: namedTools([
        "browser",
        "apply_patch",
        "workspace_process",
        "python_kernel",
        "mcp__evidence__lookup",
      ]),
    });

    expect(resolution).toEqual(
      expect.objectContaining({
        matchedRuleId: "family-fallback",
        policySource: "family",
        taskPhase: "browser",
        environmentCapabilities: [
          "browser",
          "workspace_write",
          "process",
          "code_kernel",
          "mcp",
        ],
      }),
    );
  });

  it("does not advertise workspace writes when only edit previews are available", () => {
    const resolution = resolveModelHarnessResolution({
      model: specificModel("unknown", "custom-api", "unknown-v1"),
      messages: [{ role: "user", content: "Inspect the code.", timestamp: 1 }],
      tools: namedTools(["read_file", "ast_edit_preview"]),
    });

    expect(resolution.environmentCapabilities).not.toContain("workspace_write");
  });

  it.each([
    {
      name: "duplicate IDs",
      rules: [rule("duplicate"), rule("duplicate")],
      error: "invalid or duplicated",
    },
    {
      name: "invalid patterns",
      rules: [rule("bad-pattern", { modelPattern: "[" })],
      error: "pattern is invalid",
    },
    {
      name: "invalid overrides",
      rules: [rule("bad-limit", { maxActiveTools: 33 })],
      error: "override is invalid",
    },
    {
      name: "same-priority ambiguity",
      rules: [rule("ambiguous-a"), rule("ambiguous-b")],
      error: "rules are ambiguous",
    },
  ])("fails closed for $name", ({ rules, error }) => {
    expect(() =>
      resolveModelHarnessResolution({
        model: specificModel("test", "custom-api", "test-model"),
        messages: [],
        tools: [],
        rules,
      }),
    ).toThrow(error);
  });

  it("fails closed when a model rule expands its family profile", () => {
    expect(() =>
      resolveModelHarnessResolution({
        model: specificModel("test", "custom-api", "test-model"),
        messages: [],
        tools: [],
        rules: [rule("expanding", { maxActiveTools: 21 })],
      }),
    ).toThrow("expands its family profile");
  });

  it("fails closed instead of dropping protected activated MCP tools", () => {
    const protectedTools = namedTools(
      Array.from({ length: 21 }, (_, index) => `mcp__service__tool_${index}`),
    );
    expect(() =>
      prepareModelHarnessCall({
        model: specificModel("generic", "custom-api", "generic-v1"),
        context: {
          messages: [{ role: "user", content: "Continue.", timestamp: 1 }],
          tools: protectedTools,
        },
        options: {},
        attempt: 1,
      }),
    ).toThrow("protected tools exceed");
  });

  it("keeps the v2 receipt hash-only and binds the resolved phase and capabilities", () => {
    const privatePrompt = "PRIVATE_USER_PROMPT_9dc1";
    const privateArgument = "PRIVATE_TOOL_ARGUMENT_9dc1";
    const privateCredential = "PRIVATE_API_KEY_9dc1";
    const prepared = prepareModelHarnessCall({
      model: specificModel("openai", "openai-responses", "gpt-5.4"),
      context: {
        messages: [
          { role: "user", content: `Implement ${privatePrompt}`, timestamp: 1 },
          fauxAssistantMessage(
            fauxToolCall("read_file", { path: privateArgument }),
          ),
        ],
        tools: namedTools(TOOL_NAMES, privateArgument),
      },
      options: {
        apiKey: privateCredential,
        maxRetries: 4,
        maxRetryDelayMs: 5_000,
      },
      attempt: 1,
    });

    expect(prepared.receipt).toEqual(
      expect.objectContaining({
        schemaVersion: 2,
        harnessId: "napier.model-harness-resolution.rules-v1.v2",
        baseHarnessId: "napier.model-harness.openai.v1",
        matchedRuleId: "openai-reasoning",
        policySource: "model_rule",
        taskPhase: "coding",
        guidanceSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        maxRetries: 4,
        maxRetriesSource: "caller",
        maxRetryDelayMs: 5_000,
        maxRetryDelayMsSource: "caller",
      }),
    );
    const serialized = JSON.stringify(prepared.receipt);
    expect(serialized).not.toContain(privatePrompt);
    expect(serialized).not.toContain(privateArgument);
    expect(serialized).not.toContain(privateCredential);
    const { contentSha256, ...content } = prepared.receipt;
    expect(contentSha256).toBe(sha256(canonicalJson(content)));
  });
});

function profile(api: string) {
  return resolveModelHarnessProfile({ api });
}

function context(prompt: string): Context {
  return {
    systemPrompt: "Base prompt",
    messages: [{ role: "user", content: prompt, timestamp: 1 }],
    tools: tools(),
  };
}

function tools(): Tool[] {
  return TOOL_NAMES.map((name) => ({
    name,
    description: `Use ${name}.`,
    parameters: Type.Object({}),
  }));
}

function namedTools(names: readonly string[], privateValue?: string): Tool[] {
  return names.map((name) => ({
    name,
    description: privateValue
      ? `Use ${name} with ${privateValue}.`
      : `Use ${name}.`,
    parameters: Type.Object(
      privateValue ? { [privateValue]: Type.String() } : {},
    ),
  }));
}

function specificModel(provider: string, api: string, id: string) {
  return {
    ...fauxProvider({ provider, api, models: [{ id }] }).getModel(),
    provider,
    api,
    id,
  };
}

function rule(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    priority: 100,
    providerPattern: "^test$",
    modelPattern: "^test-model$",
    guidance: "Test guidance.",
    maxActiveTools: 20,
    defaultMaxRetries: 1,
    ...overrides,
  };
}
