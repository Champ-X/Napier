import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { SubagentWorktreeChange } from "../src/subagent-worktree-diff.js";
import {
  createSubagentWorktreeReview,
  MAX_SUBAGENT_WORKTREE_REVIEW_BYTES,
} from "../src/subagent-worktree-review.js";

describe("Subagent worktree review", () => {
  it("renders a bounded live change window with safe control characters", () => {
    const review = createSubagentWorktreeReview([
      candidate(
        "src/value.ts",
        "export const value = 1;\n",
        "export const value = 2;\u001b\n",
      ),
    ]);

    expect(review.truncated).toBe(false);
    expect(review.text).toContain("File: src/value.ts");
    expect(review.text).toContain("- export const value = 1;");
    expect(review.text).toContain("+ export const value = 2;\\u001b");
    expect(review.text).not.toContain("\u001b");
  });

  it("caps aggregate UTF-8 review bytes and marks omitted candidate data", () => {
    const files = Array.from({ length: 8 }, (_, index) =>
      candidate(
        `src/value-${index}.ts`,
        `export const value${index} = "${"old".repeat(4_000)}";\n`,
        `export const value${index} = "${"new".repeat(4_000)}";\n`,
      ),
    );

    const review = createSubagentWorktreeReview(files);

    expect(review.truncated).toBe(true);
    expect(Buffer.byteLength(review.text, "utf8")).toBeLessThanOrEqual(
      MAX_SUBAGENT_WORKTREE_REVIEW_BYTES,
    );
    expect(review.text).toContain("[review truncated]");
  });
});

function candidate(
  relativePath: string,
  oldText: string,
  newText: string,
): SubagentWorktreeChange {
  const pathSha256 = sha256(relativePath);
  return {
    operation: "modify",
    path: relativePath,
    pathSha256,
    beforeSha256: sha256(oldText),
    afterSha256: sha256(newText),
    beforeText: oldText,
    afterText: newText,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
