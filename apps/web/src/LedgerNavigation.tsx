import { ChevronLeft, ChevronRight, Plus, Settings2, Wrench } from "lucide-react";

import type { LiveReadyBootstrapResponse } from "@napier/contracts/default-run-model";
import { copy } from "./copy";
import { useWorkspaceLayout } from "./use-workspace-layout";
import { WorkspaceTree } from "./WorkspaceTree";
import type { TrashedThreadReceipt } from "./use-thread-trash";

export function LedgerNavigation({
  bootstrap,
  selectedThreadId,
  busyThreadId,
  trashedThread,
  onNewThread,
  onSelect,
  onTrash,
  onRestore,
  onWorkspaceSwitch,
  onOpenWorkspaceSettings,
  onOpenDeveloperWorkbench,
  onOpenSettings,
}: {
  bootstrap: LiveReadyBootstrapResponse;
  selectedThreadId: string | undefined;
  busyThreadId: string | undefined;
  trashedThread: TrashedThreadReceipt | undefined;
  onNewThread(): void;
  onSelect(threadId: string): void;
  onTrash(threadId: string): void;
  onRestore(): void;
  onWorkspaceSwitch(root: string, threadId?: string): Promise<void>;
  onOpenWorkspaceSettings(): void;
  onOpenDeveloperWorkbench(): void;
  onOpenSettings(): void;
}) {
  const { collapsed, toggleSidebar } = useWorkspaceLayout();
  return (
    <nav
      className={`ledger-nav${collapsed ? " is-collapsed" : ""}`}
      aria-label={copy.recentThreads}
    >
      <div className="brand-lockup">
        <div className="brand-mark" aria-hidden="true">
          N
        </div>
        <div>
          <strong>{copy.appName}</strong>
          <span>{copy.appDescriptor}</span>
        </div>
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
        <Plus size={15} aria-hidden="true" />
        <span>{copy.newThread}</span>
        <kbd>N</kbd>
      </button>

      <WorkspaceTree
        currentRoot={bootstrap.workspace.root}
        threads={bootstrap.threads}
        selectedThreadId={selectedThreadId}
        busyThreadId={busyThreadId}
        trashedThread={trashedThread}
        onSelect={onSelect}
        onTrash={onTrash}
        onRestore={onRestore}
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
