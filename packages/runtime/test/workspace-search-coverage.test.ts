import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createWorkspaceTools } from "../src/tools.js";

describe("workspace search coverage", () => {
  it("finds matches beyond the directory listing output limit", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(tmpdir(), "napier-search-coverage-"),
    );
    try {
      await Promise.all(
        Array.from({ length: 301 }, (_, index) =>
          writeFile(
            path.join(
              workspaceRoot,
              `decoy-${String(index).padStart(3, "0")}.txt`,
            ),
            "irrelevant\n",
          ),
        ),
      );
      await writeFile(
        path.join(workspaceRoot, "target.txt"),
        "LATE_SEARCH_MATCH\n",
      );
      const search = createWorkspaceTools(workspaceRoot).find(
        (tool) => tool.name === "search_files",
      )!;

      const result = await search.execute("search-late-match", {
        query: "LATE_SEARCH_MATCH",
      });

      expect(result.details.matches).toEqual([
        expect.objectContaining({ path: "target.txt", line: 1 }),
      ]);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
