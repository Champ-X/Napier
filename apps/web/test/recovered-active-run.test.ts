import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("recovered active Run Web sync", () => {
  it("polls authoritative Thread detail only without an attached stream", async () => {
    const source = await readFile(
      new URL("../src/use-recovered-active-run.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("if (streamAttached) return");
    expect(source).toContain("if (!state.activeRunId || !threadId) return");
    expect(source).toContain("await getThread(threadId)");
    expect(source).toContain("mergeBackgroundThreadDetail(current, refreshed)");
    expect(source).toContain("selectedThreadIdRef.current === threadId");
    expect(source).not.toContain("activeThread: refreshed");
    expect(source).toContain("RECOVERED_RUN_REFRESH_MS = 1_000");
    expect(source).not.toContain("PRIVATE_BROWSER");
  });
});
