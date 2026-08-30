import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Thread list", () => {
  it("uses an Arena-style action menu and a transient undo toast", async () => {
    const [source, toastSource, hookSource, copySource, styles] =
      await Promise.all([
        readFile(new URL("../src/ThreadList.tsx", import.meta.url), "utf8"),
        readFile(
          new URL("../src/ThreadUndoToast.tsx", import.meta.url),
          "utf8",
        ),
        readFile(
          new URL("../src/use-thread-trash.ts", import.meta.url),
          "utf8",
        ),
        readFile(new URL("../src/copy.ts", import.meta.url), "utf8"),
        readFile(
          new URL("../src/styles/thread-interactions.css", import.meta.url),
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
    expect(copySource).toContain("Move to trash");
    expect(copySource).toContain("Moved to trash");
    expect(copySource).toContain("Undo");
    expect(source).toContain('role="menu"');
    expect(source).toContain('role="menuitem"');
    expect(source).toContain("thread-menu-trigger");
    expect(source).not.toContain("thread-trash-confirm");
    expect(toastSource).toContain('aria-live="polite"');
    expect(hookSource).toContain("THREAD_UNDO_WINDOW_MS = 5_000");
    expect(styles).toContain(".thread-action-menu");
    expect(styles).toContain(".thread-row-shell.has-open-menu");
    expect(styles).toContain("z-index: 21");
    expect(styles).toContain(".thread-undo");
    expect(styles).toContain("position: fixed");
    expect(source).not.toContain("PRIVATE_THREAD_BODY");
  });
});
