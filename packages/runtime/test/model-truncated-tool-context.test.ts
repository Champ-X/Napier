import {
  fauxAssistantMessage,
  fauxToolCall,
  type Context,
  type ToolResultMessage,
} from "@earendil-works/pi-ai";
import { expect, it } from "vitest";
import { redirectTruncatedToolContext } from "../src/model-truncated-tool-context.js";

function fixture(): Context {
  return {
    messages: [
      fauxAssistantMessage(
        [fauxToolCall("apply_patch", { content: "partial" }, { id: "write" })],
        { stopReason: "length" },
      ),
      {
        role: "toolResult",
        toolCallId: "write",
        toolName: "apply_patch",
        isError: true,
        content: [{ type: "text", text: "rejected" }],
        timestamp: 0,
      },
    ],
  };
}
it("redirects a settled length rejection once without editing historical messages", () => {
  const input = fixture();
  const output = redirectTruncatedToolContext(input);
  expect(output.messages).toHaveLength(3);
  expect(input.messages).toHaveLength(2);
  expect(output.messages[0]).toBe(input.messages[0]);
  expect(redirectTruncatedToolContext(output)).toBe(output);
});
it.each([
  "success",
  "missing-result",
  "different-call",
  "user-followup",
  "ordinary-failure",
])("does not infer pre-execution rejection from %s", (scenario) => {
  const input = fixture();
  const result = input.messages[1] as ToolResultMessage;
  if (scenario === "success") result.isError = false;
  if (scenario === "missing-result") input.messages.pop();
  if (scenario === "different-call") result.toolCallId = "other";
  if (scenario === "user-followup")
    input.messages.push({ role: "user", content: "Continue", timestamp: 1 });
  if (
    scenario === "ordinary-failure" &&
    input.messages[0]?.role === "assistant"
  )
    input.messages[0].stopReason = "toolUse";
  expect(redirectTruncatedToolContext(input)).toBe(input);
});
