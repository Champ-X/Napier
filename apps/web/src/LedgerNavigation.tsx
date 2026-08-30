import {
  ChevronLeft,
  ChevronRight,
  MessageCirclePlus,
  Settings2,
  Wrench,
} from "lucide-react";

import type { LiveReadyBootstrapResponse } from "@napier/contracts/default-run-model";
import { copy } from "./copy";
import type { WorkspaceLayoutControls } from "./use-workspace-layout";
import { WorkspaceTree } from "./WorkspaceTree";

export function LedgerNavigation({
  bootstrap,
  selectedThreadId,
  busyThreadId,
  onNewThread,
  onSelect,
  onTrash,
  onWorkspaceSwitch,
  onOpenWorkspaceSettings,
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
  onOpenWorkspaceSettings(): void;
  onOpenDeveloperWorkbench(): void;
  onOpenSettings(): void;
  layout: WorkspaceLayoutControls;
}) {
  const { collapsed, toggleSidebar } = layout;
  return (
    <nav
      className={`ledger-nav${collapsed ? " is-collapsed" : ""}`}
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
          aria-label={collapsed ? "展开会话导航" : "收起会话导航"}
          aria-pressed={collapsed}
          onClick={toggleSidebar}
        >
          {collapsed ? (
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
        onClick={onNewThread}
      >
        <MessageCirclePlus size={17} aria-hidden="true" />
        <span>{copy.newThread}</span>
      </button>

      <WorkspaceTree
        currentRoot={bootstrap.workspace.root}
        threads={bootstrap.threads}
        selectedThreadId={selectedThreadId}
        busyThreadId={busyThreadId}
        onSelect={onSelect}
        onTrash={onTrash}
        onWorkspaceSwitch={onWorkspaceSwitch}
        onOpenWorkspaceSettings={onOpenWorkspaceSettings}
      />

      <div className="workspace-control-buttons">
        <button
          className="workspace-settings-button"
          type="button"
          aria-label={copy.developerWorkbench.open}
          onClick={onOpenDeveloperWorkbench}
        >
          <Wrench size={14} aria-hidden="true" />
          <span>{copy.developerWorkbench.open}</span>
        </button>
        <button
          className="workspace-settings-button"
          type="button"
          aria-label={copy.settings}
          onClick={onOpenSettings}
        >
          <Settings2 size={14} aria-hidden="true" />
          <span>{copy.settings}</span>
        </button>
      </div>
    </nav>
  );
}
