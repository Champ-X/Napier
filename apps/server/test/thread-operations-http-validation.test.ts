import { describe, expect, it } from "vitest";

import {
  parseReviewSubagentOutcomeRequest,
  validWorkspaceTrashId,
} from "../src/thread-operations-http-validation.js";

describe("Thread operations HTTP validation", () => {
  it("accepts one exact normalized review model", () => {
    expect(
      parseReviewSubagentOutcomeRequest({
        model: { provider: " DeepSeek ", id: " deepseek-v4-flash " },
      }),
    ).toEqual({
      model: { provider: "deepseek", id: "deepseek-v4-flash" },
    });
    expect(
      parseReviewSubagentOutcomeRequest({
        model: { provider: "deepseek", id: "model" },
        extra: true,
      }),
    ).toBeUndefined();
    expect(parseReviewSubagentOutcomeRequest({})).toBeUndefined();
  });

  it("preserves the bounded Workspace Trash ID grammar", () => {
    expect(validWorkspaceTrashId("trash_12345678")).toBe(true);
    expect(validWorkspaceTrashId("trash_short")).toBe(false);
    expect(validWorkspaceTrashId("trash_1234567-")).toBe(false);
  });
});
