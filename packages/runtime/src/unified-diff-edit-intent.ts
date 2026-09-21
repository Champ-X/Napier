import type { EditIntent } from "@napier/contracts/tool-protocol";
import { sha256 } from "./ed25519.js";

interface DiffLine {
  side: " " | "+" | "-";
  text: string;
}
interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

/** Strict single-file unified diffs over a fully observed source snapshot.
 * No fuzzy context, offset search, filesystem action or implicit file creation.
 * The resulting ordinary EditIntent keeps the existing commit-time CAS path. */
export function compileUnifiedDiffEditIntent(input: {
  target: string;
  expectedSha256: string;
  source: string;
  diff: string;
}): EditIntent {
  if (sha256(input.source) !== input.expectedSha256)
    fail("source snapshot hash mismatch");
  if (
    Buffer.byteLength(input.diff, "utf8") > 256 * 1024 ||
    input.diff.includes("\0")
  )
    fail("patch exceeds text limits");
  const hunks = parseDiff(input.target, input.diff);
  const source = input.source.match(/[^\n]*\n|[^\n]+$/gu) ?? [];
  const output: string[] = [];
  let cursor = 0;
  for (const hunk of hunks) {
    const start = hunk.oldCount === 0 ? hunk.oldStart : hunk.oldStart - 1;
    const newStart = hunk.newCount === 0 ? hunk.newStart : hunk.newStart - 1;
    if (
      start < cursor ||
      start > source.length ||
      start + hunk.oldCount > source.length
    )
      fail("hunk range is overlapping or outside the source");
    output.push(...source.slice(cursor, start));
    if (output.length !== newStart)
      fail("new hunk coordinates do not match the source transformation");
    cursor = start;
    for (const line of hunk.lines) {
      if (line.side !== "+") {
        if (source[cursor] !== line.text)
          fail("hunk context did not match the read snapshot");
        cursor++;
      }
      if (line.side !== "-") output.push(line.text);
    }
  }
  output.push(...source.slice(cursor));
  if (output.slice(0, -1).some((line) => !line.endsWith("\n")))
    fail("end-of-file marker is followed by more output lines");
  const next = output.join("");
  if (next === input.source) fail("patch has no change");
  // An existing empty file still has a hashline anchor. Never convert it to a
  // create operation, which has different overwrite/authorization semantics.
  return {
    kind: "content",
    target: input.target,
    expectedSha256: input.expectedSha256,
    ...(input.source.length > 0
      ? { replacements: [{ oldText: input.source, newText: next }] }
      : {
          hashlineReplacements: [
            { line: 1, anchorSha256: sha256(""), newText: next },
          ],
        }),
  };
}

function parseDiff(target: string, diff: string): Hunk[] {
  const lines = diff.split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines[0] !== `--- a/${target}` || lines[1] !== `+++ b/${target}`)
    fail("headers must name only the exact target as a/path and b/path");
  const hunks: Hunk[] = [];
  let current: Hunk | undefined;
  let lastWasMarker = false;
  for (const line of lines.slice(2)) {
    if (line.startsWith("@@")) {
      if (current) validateHunk(current);
      const match =
        /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/u.exec(line);
      if (!match) fail("invalid hunk header");
      current = {
        oldStart: Number(match[1]),
        oldCount: Number(match[2] ?? 1),
        newStart: Number(match[3]),
        newCount: Number(match[4] ?? 1),
        lines: [],
      };
      hunks.push(current);
      lastWasMarker = false;
      continue;
    }
    if (!current) fail("expected a hunk header");
    if (line === "\\ No newline at end of file") {
      const previous = current.lines.at(-1);
      if (!previous || lastWasMarker) fail("unbound end-of-file marker");
      previous.text = previous.text.slice(0, -1);
      lastWasMarker = true;
      continue;
    }
    const side = line[0];
    if (side !== " " && side !== "+" && side !== "-")
      fail("unsupported patch line");
    current.lines.push({ side, text: line.slice(1) + "\n" });
    lastWasMarker = false;
  }
  if (!current || hunks.length > 32) fail("expected 1 to 32 hunks");
  validateHunk(current);
  return hunks;
}

function validateHunk(hunk: Hunk) {
  if (
    ![hunk.oldStart, hunk.oldCount, hunk.newStart, hunk.newCount].every(
      Number.isSafeInteger,
    ) ||
    (hunk.oldCount > 0 && hunk.oldStart < 1) ||
    (hunk.newCount > 0 && hunk.newStart < 1) ||
    hunk.lines.filter((line) => line.side !== "+").length !== hunk.oldCount ||
    hunk.lines.filter((line) => line.side !== "-").length !== hunk.newCount
  )
    fail("hunk counts do not match its lines");
}

function fail(reason: string): never {
  throw new Error(`Unified diff ${reason}; read_file then rebuild the edit`);
}
