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
