import {
  ChevronLeft,
  ChevronRight,
  MessageCirclePlus,
  Loader2,
  Search,
  Settings2,
  Wrench,
} from "lucide-react";
import { Fragment, memo, useEffect, useRef, useState } from "react";

import type { LiveReadyBootstrapResponse } from "@napier/contracts/default-run-model";
import { copy } from "./copy";
import type { WorkspaceLayoutControls } from "./use-workspace-layout";
import { WorkspaceTree } from "./WorkspaceTree";
import { workspaceTreeCopy as t } from "./workspace-tree-copy";

export interface LedgerNavigationProps {
  bootstrap: LiveReadyBootstrapResponse;
  selectedThreadId: string | undefined;
  busyThreadId: string | undefined;
  newThreadBusy: boolean;
  onNewThread(): void;
  onSelect(threadId: string): void;
  onTrash(threadId: string): void;
  onWorkspaceSwitch(root: string, threadId?: string): Promise<void>;
  onOpenDeveloperWorkbench(): void;
  onOpenSettings(): void;
  layout: WorkspaceLayoutControls;
}

export const LedgerNavigation = memo(function LedgerNavigation({
  bootstrap,
  selectedThreadId,
  busyThreadId,
  newThreadBusy,
  onNewThread,
  onSelect,
  onTrash,
  onWorkspaceSwitch,
  onOpenDeveloperWorkbench,
  onOpenSettings,
  layout,
}: LedgerNavigationProps) {
  const {
    collapsed,
    closeSidebar,
    mobileNavigationOpen,
    openSidebar,
    toggleSidebar,
  } = layout;
  const visuallyCollapsed = collapsed && !mobileNavigationOpen;
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const openSearch = () => {
    if (visuallyCollapsed) openSidebar();
    requestAnimationFrame(() => searchRef.current?.focus());
  };
  useEffect(() => {
    if (!mobileNavigationOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeSidebar();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeSidebar, mobileNavigationOpen]);
  return (
    <Fragment>
      {mobileNavigationOpen ? (
        <button
          type="button"
          className="ledger-nav-backdrop"
          tabIndex={-1}
          aria-label="关闭会话导航"
          onClick={closeSidebar}
        />
      ) : null}
      <nav
        className={`ledger-nav${visuallyCollapsed ? " is-collapsed" : ""}${mobileNavigationOpen ? " is-mobile-open" : ""}`}
        aria-label={copy.recentThreads}
      >
        <div className="brand-lockup">
          <span className="brand-mark-frame" aria-hidden="true">
            <img className="brand-mark" src="/napier-mark.png" alt="" />
          </span>
          <strong>{copy.appName}</strong>
          <button
            className="ledger-collapse-button"
            type="button"
            aria-label={visuallyCollapsed ? "展开会话导航" : "收起会话导航"}
            aria-pressed={visuallyCollapsed}
            onClick={toggleSidebar}
          >
            {visuallyCollapsed ? (
              <ChevronRight size={14} aria-hidden="true" />
            ) : (
              <ChevronLeft size={14} aria-hidden="true" />
            )}
          </button>
        </div>

        <button
          className="new-ledger-button"
          type="button"
          aria-label={copy.newThread}
          aria-busy={newThreadBusy}
          disabled={newThreadBusy}
          onClick={() => {
            onNewThread();
            closeSidebar();
          }}
        >
          {newThreadBusy ? (
            <Loader2 size={17} aria-hidden="true" className="spin" />
          ) : (
            <MessageCirclePlus size={17} aria-hidden="true" />
          )}
          <span>{copy.newThread}</span>
        </button>

        <div className="ledger-search">
          {visuallyCollapsed ? (
            <button type="button" aria-label={t.search} onClick={openSearch}>
              <Search size={17} aria-hidden="true" />
            </button>
          ) : (
            <label>
              <Search size={15} aria-hidden="true" />
              <input
                ref={searchRef}
                type="search"
                aria-label={t.search}
                value={searchQuery}
                placeholder={t.searchPlaceholder}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </label>
          )}
        </div>

        <WorkspaceTree
          currentRoot={bootstrap.workspace.root}
          threads={bootstrap.threads}
          selectedThreadId={selectedThreadId}
          busyThreadId={busyThreadId}
          onSelect={(threadId) => {
            onSelect(threadId);
            closeSidebar();
          }}
          onTrash={onTrash}
          onWorkspaceSwitch={async (root, threadId) => {
            await onWorkspaceSwitch(root, threadId);
            closeSidebar();
          }}
          searchQuery={searchQuery}
        />

        <div className="workspace-control-buttons">
          <button
            className="workspace-settings-button workbench-settings workbench-developer"
            type="button"
            aria-label={copy.developerWorkbench.open}
            onClick={() => {
              onOpenDeveloperWorkbench();
              closeSidebar();
            }}
          >
            <Wrench size={14} aria-hidden="true" />
            <span>{copy.developerWorkbench.open}</span>
          </button>
          <button
            className="workspace-settings-button workbench-settings"
            type="button"
            aria-label={copy.settings}
            onClick={() => {
              onOpenSettings();
              closeSidebar();
            }}
          >
            <Settings2 size={14} aria-hidden="true" />
            <span>{copy.settings}</span>
          </button>
        </div>
      </nav>
    </Fragment>
  );
}, sameLedgerNavigationProps);

function sameLedgerNavigationProps(
  previous: LedgerNavigationProps,
  next: LedgerNavigationProps,
): boolean {
  return (
    previous.bootstrap === next.bootstrap &&
    previous.selectedThreadId === next.selectedThreadId &&
    previous.busyThreadId === next.busyThreadId &&
    previous.newThreadBusy === next.newThreadBusy &&
    previous.onNewThread === next.onNewThread &&
    previous.onSelect === next.onSelect &&
    previous.onTrash === next.onTrash &&
    previous.onWorkspaceSwitch === next.onWorkspaceSwitch &&
    previous.onOpenDeveloperWorkbench === next.onOpenDeveloperWorkbench &&
    previous.onOpenSettings === next.onOpenSettings &&
    previous.layout.collapsed === next.layout.collapsed &&
    previous.layout.mobileNavigationOpen === next.layout.mobileNavigationOpen &&
    previous.layout.toggleSidebar === next.layout.toggleSidebar &&
    previous.layout.openSidebar === next.layout.openSidebar &&
    previous.layout.closeSidebar === next.layout.closeSidebar
  );
}
