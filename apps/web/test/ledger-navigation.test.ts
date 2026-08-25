import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Ledger navigation", () => {
  it("keeps manual desktop collapse without hiding the thread list", async () => {
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

    // The desktop rail keeps only the operator-controlled expanded/collapsed
    // states and never hides the navigation behind a viewport drawer.
    expect(source).toContain("useWorkspaceLayout()");
    expect(source).toContain('`ledger-nav${collapsed ? " is-collapsed" : ""}');
    expect(source).toContain("aria-pressed={collapsed}");
    expect(source).toContain("onClick={toggleSidebar}");
    expect(source).toContain("展开会话导航");
    expect(source).toContain("收起会话导航");
    expect(source).toContain("aria-label={copy.newThread}");
    expect(source).toContain("aria-label={copy.settings}");
    expect(layout).toContain("setCollapsed((current) => !current)");
    expect(layout).not.toContain("window.innerWidth");
    expect(layout).not.toContain("navOpen");
    expect(source).not.toContain("is-overlay");
    expect(source).not.toContain("ledger-nav-backdrop");
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
    expect(source).toContain("onClick={onOpenSettings}");
    expect(source).toContain(
      "onOpenWorkspaceSettings={onOpenWorkspaceSettings}",
    );
    expect(tree).toContain("aria-label={t.addWorkspace}");
    expect(tree).toContain("<LazyWorkspaceFolderPicker");
    expect(tree).toContain("onWorkspaceSwitch={onWorkspaceSwitch}");
  });
});
