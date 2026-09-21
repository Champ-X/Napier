import { expect, it } from "vitest";
import { compileUnifiedDiffEditIntent } from "../src/unified-diff-edit-intent.js";
import { sha256 } from "../src/ed25519.js";

const intent = (source: string, diff: string) =>
  compileUnifiedDiffEditIntent({
    target: "file.txt",
    expectedSha256: sha256(source),
    source,
    diff: `--- a/file.txt\n+++ b/file.txt\n${diff}`,
  });
it("normalizes insertions, multiple hunks, deletions and final newline changes to one CAS edit", () => {
  expect(
    intent(
      "a\nb\nc\nd\n",
      "@@ -1,2 +1,3 @@\n a\n+x\n b\n@@ -4 +5 @@\n-d\n+D\n",
    ),
  ).toMatchObject({
    replacements: [{ oldText: "a\nb\nc\nd\n", newText: "a\nx\nb\nc\nD\n" }],
  });
  expect(intent("a\nb\n", "@@ -2 +1,0 @@\n-b\n")).toMatchObject({
    replacements: [{ newText: "a\n" }],
  });
  expect(
    intent("a", "@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+A\n"),
  ).toMatchObject({ replacements: [{ newText: "A\n" }] });
  expect(
    intent("a\n", "@@ -1 +1 @@\n-a\n+A\n\\ No newline at end of file\n"),
  ).toMatchObject({ replacements: [{ newText: "A" }] });
  expect(intent("", "@@ -0,0 +1 @@\n+first\n")).toMatchObject({
    hashlineReplacements: [{ line: 1, newText: "first\n" }],
  });
});

it.each([
  "@@ -1 +1 @@\n-wrong\n+A\n",
  "@@ -1,2 +1 @@\n-a\n+A\n",
  "@@ -1 +5 @@\n-a\n+A\n",
  "@@ -1 +1 @@\n-a\n+A\n@@ -1 +1 @@\n-a\n+B\n",
  "@@ -1 +1,2 @@\n-a\n+A\n\\ No newline at end of file\n+B\n",
  "@@ -1 +1 @@\n-a\n+A\n--- a/other\n+++ b/other\n",
])(
  "rejects malformed or unobserved patch content without fuzzy recovery",
  (diff) => {
    expect(() => intent("a\n", diff)).toThrow("Unified diff");
  },
);
