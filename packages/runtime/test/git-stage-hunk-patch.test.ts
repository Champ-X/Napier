import { describe, expect, it } from "vitest";

import { gitStageOperationArgumentsSha256 } from "../src/git-stage-hunk-arguments.js";
import {
  normalizeGitStageHunkIndexes,
  selectGitStageHunks,
} from "../src/git-stage-hunk-patch.js";
import { gitStageArgumentsSha256 } from "../src/git-inspect-arguments.js";

const TWO_HUNK_PATCH = [
  "diff --git a/source.txt b/source.txt",
  "index 1111111..2222222 100644",
  "--- a/source.txt",
  "+++ b/source.txt",
  "@@ -2 +2 @@",
  "-before-one",
  "+after-one",
  "@@ -18 +18 @@",
  "-before-two",
  "+after-two",
  "",
].join("\n");

describe("Git stage hunk patch selection", () => {
  it("selects complete one-based hunks under a deterministic hash", () => {
    const selection = selectGitStageHunks(TWO_HUNK_PATCH, [2]);

    expect(selection).toEqual(
      expect.objectContaining({
        mode: "hunks",
        selectedHunkCount: 1,
        selectionSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(selection.selectedPatch).toContain("@@ -18 +18 @@");
    expect(selection.selectedPatch).toContain("+after-two");
    expect(selection.selectedPatch).not.toContain("+after-one");
    expect(selectGitStageHunks(TWO_HUNK_PATCH, [2]).selectionSha256).toBe(
      selection.selectionSha256,
    );
    expect(selectGitStageHunks(TWO_HUNK_PATCH, [1]).selectionSha256).not.toBe(
      selection.selectionSha256,
    );
  });

  it("rejects invalid indexes and non-modification patch forms", () => {
    for (const indexes of [[], [0], [1, 1], [2, 1], [33]]) {
      expect(() => normalizeGitStageHunkIndexes(indexes)).toThrow();
    }
    expect(() => selectGitStageHunks(TWO_HUNK_PATCH, [3])).toThrow(
      "available hunks",
    );
    expect(() =>
      selectGitStageHunks(
        TWO_HUNK_PATCH.replace("-before-one", " before-one"),
        [1],
      ),
    ).toThrow("line counts");
    expect(() =>
      selectGitStageHunks(TWO_HUNK_PATCH.replaceAll("\n", "\r\n"), [1]),
    ).toThrow("canonical text");

    for (const header of [
      "new file mode 100644",
      "deleted file mode 100644",
      "old mode 100644",
      "new mode 100755",
      "rename from source.txt",
      "Binary files a/source.txt and b/source.txt differ",
      "GIT binary patch",
    ]) {
      const patch = TWO_HUNK_PATCH.replace(
        "index 1111111..2222222 100644",
        `index 1111111..2222222 100644\n${header}`,
      );
      expect(() => selectGitStageHunks(patch, [1])).toThrow(
        "existing text modification",
      );
    }
  });

  it("preserves path-stage argv evidence and binds exact hunk selection", () => {
    const repository = {
      root: "/workspace",
      gitDirectory: "/workspace/.git",
    };
    const pathSelection = "a".repeat(64);
    const firstHunk = "b".repeat(64);
    const secondHunk = "c".repeat(64);

    expect(
      gitStageOperationArgumentsSha256(
        repository,
        ["source.txt"],
        3,
        "path",
        pathSelection,
      ),
    ).toBe(gitStageArgumentsSha256(repository, "source.txt", 3));
    expect(
      gitStageOperationArgumentsSha256(
        repository,
        ["source.txt"],
        3,
        "hunks",
        firstHunk,
      ),
    ).not.toBe(
      gitStageOperationArgumentsSha256(
        repository,
        ["source.txt"],
        3,
        "hunks",
        secondHunk,
      ),
    );
    expect(
      gitStageOperationArgumentsSha256(
        repository,
        ["a.txt", "b.txt"],
        3,
        "path",
        pathSelection,
      ),
    ).not.toBe(gitStageArgumentsSha256(repository, "a.txt", 3));
  });
});
