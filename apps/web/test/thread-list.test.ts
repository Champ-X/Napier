import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Thread list", () => {
  it("keeps confirmation, active-run denial, and undo explicit", async () => {
    const [source, copySource, styles] = await Promise.all([
      readFile(new URL("../src/ThreadList.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/copy.ts", import.meta.url), "utf8"),
      readFile(
        new URL("../src/styles/shell-navigation.css", import.meta.url),
        "utf8",
      ),
    ]);

    // The user-facing trash copy is externalized into copy.ts (default locale)
    // so it can be localized; ThreadList consumes it through copy.trash.
    expect(source).toContain("copy.trash");
    expect(copySource).toContain("Move ledger to trash");
    expect(copySource).toContain(
      "Stop the active run before deleting this ledger",
    );
    expect(copySource).toContain("Move this ledger to trash?");
    expect(copySource).toContain("Moved to trash");
    expect(copySource).toContain("Undo");
    expect(source).toContain('role="alert"');
    expect(source).toContain('aria-live="polite"');
    expect(styles).toContain(".thread-trash-confirm");
    expect(styles).toContain(".thread-undo");
    expect(source).not.toContain("PRIVATE_THREAD_BODY");
  });
});
