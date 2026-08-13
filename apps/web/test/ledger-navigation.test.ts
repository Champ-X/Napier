import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Ledger navigation", () => {
  it("supports explicit desktop collapse without hiding the thread list", async () => {
    const [source, styles] = await Promise.all([
      readFile(new URL("../src/LedgerNavigation.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
    ]);

    expect(source).toContain("useState(false)");
    expect(source).toContain(
      'className={`ledger-nav${collapsed ? " is-collapsed" : ""}`}',
    );
    expect(source).toContain("aria-pressed={collapsed}");
    expect(source).toContain("Expand ledger navigation");
    expect(source).toContain("Collapse ledger navigation");
    expect(source).toContain("<LazyThreadList");
    expect(styles).toContain(".app-shell:has(.ledger-nav.is-collapsed)");
    expect(styles).toContain(".ledger-nav.is-collapsed .thread-row");
    expect(styles).toContain(
      "grid-template-columns: 72px minmax(520px, 1fr) 338px",
    );
    expect(styles).toContain(".ledger-collapse-button");
  });
});
