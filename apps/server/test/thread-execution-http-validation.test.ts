import { describe, expect, it } from "vitest";

import {
  parsePromptRequest,
  parseResumeRunRequest,
} from "../src/thread-execution-http-validation.js";

describe("Thread execution HTTP validation", () => {
  it("accepts only exact optional Resume fields", () => {
    expect(parseResumeRunRequest(undefined)).toEqual({});
    expect(
      parseResumeRunRequest({
        runId: "run_12345678",
        model: { provider: " DeepSeek ", id: " deepseek-v4-flash " },
      }),
    ).toEqual({
      runId: "run_12345678",
      model: { provider: "deepseek", id: "deepseek-v4-flash" },
    });
    expect(
      parseResumeRunRequest({
        runId: "run_12345678",
        extra: true,
      }),
    ).toBeUndefined();
    expect(parseResumeRunRequest({ runId: "runctl_12345678" })).toBeUndefined();
  });

  it("preserves the Prompt character bound and non-blank requirement", () => {
    const text = "\u76ee".repeat(60_000);
    expect(parsePromptRequest({ text })).toEqual({ text });
    expect(parsePromptRequest({ text: `${text}\u76ee` })).toBeUndefined();
    expect(parsePromptRequest({ text: " \n\t " })).toBeUndefined();
  });

  it("normalizes an optional ModelRef and rejects extra fields", () => {
    expect(
      parsePromptRequest({
        text: "Continue from the durable evidence.",
        model: { provider: " DeepSeek ", id: " deepseek-v4-flash " },
      }),
    ).toEqual({
      text: "Continue from the durable evidence.",
      model: { provider: "deepseek", id: "deepseek-v4-flash" },
    });
    expect(
      parsePromptRequest({
        text: "Continue.",
        model: { provider: "deepseek", id: "deepseek-v4-flash" },
        extra: true,
      }),
    ).toBeUndefined();
  });

  it("normalizes an explicit bounded Model route", () => {
    expect(
      parsePromptRequest({
        text: "Use safe fallback.",
        modelRoute: {
          role: "reasoning",
          fallbackModels: [
            { provider: " OpenAI ", id: " gpt-5.4 " },
            { provider: "Anthropic", id: "claude-sonnet-4-6" },
          ],
        },
      }),
    ).toEqual({
      text: "Use safe fallback.",
      modelRoute: {
        role: "reasoning",
        fallbackModels: [
          { provider: "openai", id: "gpt-5.4" },
          { provider: "anthropic", id: "claude-sonnet-4-6" },
        ],
      },
    });
    expect(
      parsePromptRequest({
        text: "Reject unknown roles.",
        modelRoute: { role: "creative" },
      }),
    ).toBeUndefined();
    expect(
      parsePromptRequest({
        text: "Reject duplicate fallbacks.",
        modelRoute: {
          fallbackModels: [
            { provider: "openai", id: "gpt-5.4" },
            { provider: "OPENAI", id: "gpt-5.4" },
          ],
        },
      }),
    ).toBeUndefined();
    expect(
      parsePromptRequest({
        text: "Reject too many fallbacks.",
        modelRoute: {
          fallbackModels: Array.from({ length: 5 }, (_, index) => ({
            provider: "openai",
            id: `gpt-${String(index)}`,
          })),
        },
      }),
    ).toBeUndefined();
  });

  it("normalizes bounded role-specific Subagent routes", () => {
    expect(
      parsePromptRequest({
        text: "Route child roles independently.",
        modelRoute: {
          subagentRoles: {
            researcher: {
              model: { provider: " OpenAI ", id: " gpt-5.4 " },
              fallbackModels: [
                { provider: "Anthropic", id: "claude-sonnet-4-6" },
              ],
            },
          },
        },
      }),
    ).toEqual({
      text: "Route child roles independently.",
      modelRoute: {
        subagentRoles: {
          researcher: {
            model: { provider: "openai", id: "gpt-5.4" },
            fallbackModels: [
              { provider: "anthropic", id: "claude-sonnet-4-6" },
            ],
          },
        },
      },
    });
    expect(
      parsePromptRequest({
        text: "Reject unknown child roles.",
        modelRoute: {
          subagentRoles: {
            planner: { model: { provider: "openai", id: "gpt-5.4" } },
          },
        },
      }),
    ).toBeUndefined();
    expect(
      parsePromptRequest({
        text: "Reject child primary duplication.",
        modelRoute: {
          subagentRoles: {
            reviewer: {
              model: { provider: "openai", id: "gpt-5.4" },
              fallbackModels: [
                { provider: "OPENAI", id: "gpt-5.4" },
              ],
            },
          },
        },
      }),
    ).toBeUndefined();
  });

  it("accepts only an exact optional Source continuity Run ID", () => {
    expect(
      parsePromptRequest({
        text: "Continue the pinned private Sources.",
        sourceContinuityRunId: "run_12345678",
      }),
    ).toEqual({
      text: "Continue the pinned private Sources.",
      sourceContinuityRunId: "run_12345678",
    });
    expect(
      parsePromptRequest({
        text: "Continue.",
        sourceContinuityRunId: "runctl_12345678",
      }),
    ).toBeUndefined();
  });

  it("accepts only a shared temporary capability preset ID", () => {
    expect(
      parsePromptRequest({
        text: "Use one temporary mode.",
        capabilityPreset: "safe_automation",
      }),
    ).toEqual({
      text: "Use one temporary mode.",
      capabilityPreset: "safe_automation",
    });
    expect(
      parsePromptRequest({
        text: "Reject unknown authority.",
        capabilityPreset: "unrestricted_everything",
      }),
    ).toBeUndefined();
  });
});
