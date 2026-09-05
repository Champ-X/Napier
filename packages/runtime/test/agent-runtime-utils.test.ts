import { describe, expect, it } from "vitest";
import type { AgentTool } from "@earendil-works/pi-agent-core";

import {
  formatPlanToolGuidance,
  publicModelFailureMessage,
} from "../src/agent-runtime-utils.js";

describe("Agent Runtime progress guidance", () => {
  it("asks every tool-driven run for concise public phase narration", () => {
    const guidance = formatPlanToolGuidance([
      { name: "read_file" } as AgentTool,
    ]);

    expect(guidance).toContain("<operator_progress_protocol>");
    expect(guidance).toContain("what the evidence established");
    expect(guidance).toContain("same assistant response as the tool call");
    expect(guidance).toContain("Do not expose private chain-of-thought");
    expect(guidance).toContain("implementation to verification");
    expect(guidance).not.toContain("<plan_tool_protocol>");
  });

  it("asks long-running tool runs for evidence-grounded stage conclusions", () => {
    const guidance = formatPlanToolGuidance([
      { name: "record_run_milestone" } as AgentTool,
    ]);

    expect(guidance).toContain("<operator_progress_protocol>");
    expect(guidance).toContain("record_run_milestone");
    expect(guidance).toContain("progress conclusions during the Run");
    expect(guidance).toContain("completed tool evidence");
    expect(guidance).toContain("openLoops");
    expect(guidance).toContain("Do not record milestones after minor actions");
  });

  it("requires dependent plan transitions to wait for prior results", () => {
    const guidance = formatPlanToolGuidance([
      { name: "update_plan_step" } as AgentTool,
    ]);

    expect(guidance).toContain(
      "Do not batch transitions for dependency-linked steps in the same assistant response",
    );
    expect(guidance).toContain("Wait for each update_plan_step result");
    expect(guidance).toContain("readyStepIds and parallelReadyStepIds");
    expect(guidance).toContain(
      "only steps already listed together in parallelReadyStepIds may be batched",
    );
  });

  it("does not add progress guidance when no tools are active", () => {
    expect(formatPlanToolGuidance([])).toBe("");
  });
});

describe("Agent Runtime public model failure recovery", () => {
  it.each([
    [
      "aborted",
      undefined,
      "Model call was aborted. Retry when the task is ready to continue.",
    ],
    [
      "error",
      "401 invalid API key",
      "Model provider authentication failed. Restore the selected credential reference, verify it with Doctor, then retry.",
    ],
    [
      "error",
      "429 rate limit exceeded",
      "Model provider capacity or quota was exhausted. Wait for the provider limit to reset or select another configured model, then retry.",
    ],
    [
      "error",
      "No endpoints found for this model",
      "The selected model is unavailable at the provider. Choose a current catalog model or verify the provider with Doctor, then retry.",
    ],
    [
      "error",
      "Maximum context length exceeded",
      "The model context exceeded the provider limit. Start a smaller follow-up or reduce attached context, then retry.",
    ],
    [
      "error",
      "503 service temporarily unavailable",
      "The model provider or network failed temporarily. Retry the same Run; select another configured model if the failure persists.",
    ],
    [
      "error",
      "terminated",
      "The model response stream ended unexpectedly. Safely resume the Run; select another configured model if the connection keeps failing.",
    ],
    [
      "error",
      "PRIVATE_PROVIDER_DIAGNOSTIC",
      "The model provider call failed. Verify the selected provider and model with Doctor, then retry or choose another configured model.",
    ],
  ] as const)(
    "projects a safe recovery for %s provider failures",
    (stopReason, diagnostic, expected) => {
      const message = publicModelFailureMessage(stopReason, diagnostic);
      expect(message).toBe(expected);
      if (diagnostic) expect(message).not.toContain(diagnostic);
    },
  );
});
