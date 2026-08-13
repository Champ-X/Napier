import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Thread list", () => {
  it("keeps confirmation, active-run denial, and undo explicit", async () => {
    const [source, styles] = await Promise.all([
      readFile(new URL("../src/ThreadList.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
    ]);

    expect(source).toContain("Move ledger to trash");
    expect(source).toContain("Stop the active run before deleting this ledger");
    expect(source).toContain("Move this ledger to trash?");
    expect(source).toContain("Moved to trash");
    expect(source).toContain("Undo");
    expect(source).toContain('role="alert"');
    expect(source).toContain('aria-live="polite"');
    expect(styles).toContain(".thread-trash-confirm");
    expect(styles).toContain(".thread-undo");
    expect(source).not.toContain("PRIVATE_THREAD_BODY");
  });
});
