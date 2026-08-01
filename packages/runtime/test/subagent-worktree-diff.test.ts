import { describe, expect, it } from "vitest";

import { sha256 } from "../src/ed25519.js";
import {
  createSubagentWorktreeCandidate,
  type SubagentWorktreeFile,
  type SubagentWorktreeSnapshot,
} from "../src/subagent-worktree-diff.js";

describe("Subagent worktree lifecycle diff", () => {
  it("rejects ambiguous same-content rename pairing", () => {
    const content = "same\n";
    const baseline = snapshot([
      file("src/left.ts", content, 0o644),
      file("src/right.ts", content, 0o755),
    ]);
    const candidate = snapshot([
      file("src/new-left.ts", content, 0o600),
      file("src/new-right.ts", content, 0o600),
    ]);

    expect(() =>
      createSubagentWorktreeCandidate({
        baseline,
        candidate,
        writePaths: [
          "src/left.ts",
          "src/new-left.ts",
          "src/new-right.ts",
          "src/right.ts",
        ],
      }),
    ).toThrow("ambiguous same-content rename");
  });
});

function snapshot(files: SubagentWorktreeFile[]): SubagentWorktreeSnapshot {
  return {
    files,
    fileCount: files.length,
    bytes: files.reduce((total, candidate) => total + candidate.sizeBytes, 0),
    contentSha256: sha256(
      JSON.stringify(
        files.map((candidate) => ({
          path: candidate.path,
          fileSha256: candidate.fileSha256,
          mode: candidate.mode,
        })),
      ),
    ),
  };
}

function file(
  relativePath: string,
  content: string,
  mode: number,
): SubagentWorktreeFile {
  const buffer = Buffer.from(content);
  return {
    path: relativePath,
    pathSha256: sha256(relativePath),
    fileSha256: sha256(buffer),
    sizeBytes: buffer.byteLength,
    mode,
    buffer,
  };
}
