import {
  ChevronLeft,
  ChevronRight,
  MessageCirclePlus,
  Search,
  Settings2,
  Wrench,
} from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";

import type { LiveReadyBootstrapResponse } from "@napier/contracts/default-run-model";
import { copy } from "./copy";
import type { WorkspaceLayoutControls } from "./use-workspace-layout";
import { WorkspaceTree } from "./WorkspaceTree";
import { workspaceTreeCopy as t } from "./workspace-tree-copy";

export function LedgerNavigation({
  bootstrap,
  selectedThreadId,
  busyThreadId,
  onNewThread,
  onSelect,
  onTrash,
  onWorkspaceSwitch,
  onOpenDeveloperWorkbench,
  onOpenSettings,
  layout,
}: {
  bootstrap: LiveReadyBootstrapResponse;
  selectedThreadId: string | undefined;
  busyThreadId: string | undefined;
  onNewThread(): void;
  onSelect(threadId: string): void;
  onTrash(threadId: string): void;
  onWorkspaceSwitch(root: string, threadId?: string): Promise<void>;
  onOpenDeveloperWorkbench(): void;
  onOpenSettings(): void;
  layout: WorkspaceLayoutControls;
}) {
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
          onClick={() => {
            onNewThread();
            closeSidebar();
          }}
        >
          <MessageCirclePlus size={17} aria-hidden="true" />
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
}
