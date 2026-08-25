import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Ledger navigation", () => {
  it("collapses at the compact desktop breakpoint without hiding the thread list", async () => {
    const [source, layout, tree, styles] = await Promise.all([
      readFile(new URL("../src/LedgerNavigation.tsx", import.meta.url), "utf8"),
      readFile(
        new URL("../src/use-workspace-layout.ts", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../src/WorkspaceTree.tsx", import.meta.url), "utf8"),
      readFile(
        new URL("../src/styles/shell-navigation.css", import.meta.url),
        "utf8",
      ),
    ]);

    // The compact-rail decision now lives in the solver-backed hook rather
    // than a hand-guessed media-query breakpoint inside the navigation.
    expect(source).toContain("useWorkspaceLayout()");
    expect(source).toContain('`ledger-nav${collapsed ? " is-collapsed" : ""}');
    expect(source).toContain("aria-pressed={collapsed}");
    expect(source).toContain("onClick={toggleSidebar}");
    expect(source).toContain("展开会话导航");
    expect(source).toContain("收起会话导航");
    expect(source).toContain("aria-label={copy.newThread}");
    expect(source).toContain("aria-label={copy.settings}");
    // The hook is SSR-safe and drives collapse from the resolved layout.
    expect(layout).toContain('typeof window === "undefined"');
    expect(layout).toContain("resolveWorkspaceLayout");
    expect(layout).toContain('addEventListener("resize"');
    // Sessions now nest under the workspace folder in WorkspaceTree; the
    // navigation shell renders the merged tree instead of a bare thread list.
    expect(source).toContain("<WorkspaceTree");
    expect(tree).toContain("<LazyThreadList");
    expect(styles).toContain(".app-shell:has(.ledger-nav.is-collapsed)");
    expect(styles).toContain(".ledger-nav.is-collapsed .thread-row");
    expect(styles).toContain(
      "grid-template-columns: var(--shell-nav-compact-width) minmax(0, 1fr)",
    );
    expect(styles).not.toContain("minmax(520px, 1fr) 338px");
    expect(styles).toContain(".ledger-collapse-button");
    expect(source).toContain('className="workspace-settings-button"');
    expect(source).toContain("dismissAfter(onOpenSettings)");
    expect(source).toContain(
      "onOpenWorkspaceSettings={onOpenWorkspaceSettings}",
    );
    expect(tree).toContain("aria-label={t.addWorkspace}");
    expect(tree).toContain("<LazyWorkspaceFolderPicker");
    expect(tree).toContain("onWorkspaceSwitch={onWorkspaceSwitch}");
  });

  it("renders the sidebar as a dismissable overlay drawer below the single-column breakpoint", async () => {
    const [source, layout, styles] = await Promise.all([
      readFile(new URL("../src/LedgerNavigation.tsx", import.meta.url), "utf8"),
      readFile(
        new URL("../src/use-workspace-layout.ts", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../src/styles/shell-navigation.css", import.meta.url),
        "utf8",
      ),
    ]);

    // Design §13: the hook exposes overlay drawer state driven by the solver's
    // single-column mode rather than a hand-written media query.
    expect(layout).toContain('layout.mode === "single-column"');
    expect(layout).toContain("navOpen");
    expect(layout).toContain("closeNav");
    // The drawer never lingers over a restored grid.
    expect(layout).toContain("if (!overlay && navOpen) setNavOpen(false);");

    // The navigation renders a menu trigger, a scrim, and the overlay rail with
    // an accessible open/close relationship.
    expect(source).toContain('className="ledger-nav-trigger"');
    expect(source).toContain("aria-controls={navId}");
    expect(source).toContain("aria-expanded={navOpen}");
    expect(source).toContain('className="ledger-nav-backdrop"');
    expect(source).toContain('" is-overlay"');
    expect(source).toContain('navOpen ? " is-open" : ""');
    // Inert + aria-hidden keep the closed drawer out of the tab order (§18.3).
    expect(source).toContain("inert={navHidden}");
    // Escape and selecting an item both dismiss the drawer and restore focus.
    expect(source).toContain('event.key === "Escape"');
    expect(source).toContain("triggerRef.current?.focus()");
    expect(source).toContain("dismissAfter");

    // The shell drops the sidebar grid column and the drawer slides in as a
    // fixed overlay with a scrim, using tokens only (no color literals here).
    expect(styles).toContain(".app-shell:has(.ledger-nav.is-overlay)");
    expect(styles).toContain(".ledger-nav.is-overlay {");
    expect(styles).toContain(".ledger-nav.is-overlay.is-open {");
    expect(styles).toContain(".ledger-nav-trigger {");
    expect(styles).toContain(".ledger-nav-backdrop {");
    const overlayBlock = styles.slice(
      styles.indexOf(".app-shell:has(.ledger-nav.is-overlay)"),
      styles.indexOf(".ledger-nav {"),
    );
    expect(overlayBlock).not.toMatch(/#[0-9a-f]{3,8}\b/iu);
  });
});
