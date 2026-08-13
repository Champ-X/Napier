import { describe, expect, it } from "vitest";

import { publicModelFailureMessage } from "../src/agent-runtime-utils.js";

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
