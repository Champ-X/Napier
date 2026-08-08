import { lazy, Suspense, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Database,
  Plus,
} from "lucide-react";

import type { LiveReadyBootstrapResponse } from "@napier/contracts/default-run-model";
import { copy } from "./copy";
import type { TrashedThreadReceipt } from "./use-thread-trash";

const LazyThreadList = lazy(() => import("./ThreadList"));

export function LedgerNavigation({
  bootstrap,
  selectedThreadId,
  busyThreadId,
  trashedThread,
  onNewThread,
  onSelect,
  onTrash,
  onRestore,
}: {
  bootstrap: LiveReadyBootstrapResponse;
  selectedThreadId: string | undefined;
  busyThreadId: string | undefined;
  trashedThread: TrashedThreadReceipt | undefined;
  onNewThread(): void;
  onSelect(threadId: string): void;
  onTrash(threadId: string): void;
  onRestore(): void;
}) {
  const [collapsed, setCollapsed] = useState(false);
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
          aria-label={collapsed ? "Expand ledger navigation" : "Collapse ledger navigation"}
          aria-pressed={collapsed}
          onClick={() => setCollapsed((current) => !current)}
        >
          {collapsed ? (
            <ChevronRight size={14} aria-hidden="true" />
          ) : (
            <ChevronLeft size={14} aria-hidden="true" />
          )}
        </button>
      </div>

      <button className="new-ledger-button" type="button" onClick={onNewThread}>
        <Plus size={15} aria-hidden="true" />
        <span>{copy.newThread}</span>
        <kbd>N</kbd>
      </button>

      <div className="nav-section-heading">
        <span>{copy.recentThreads}</span>
        <span>{String(bootstrap.threads.length).padStart(2, "0")}</span>
      </div>
      <Suspense fallback={<div className="thread-list" />}>
        <LazyThreadList
          threads={bootstrap.threads}
          selectedThreadId={selectedThreadId}
          busyThreadId={busyThreadId}
          trashedThread={trashedThread}
          onSelect={onSelect}
          onTrash={onTrash}
          onRestore={onRestore}
        />
      </Suspense>

      <div className="workspace-stamp">
        <Database size={14} aria-hidden="true" />
        <div>
          <span>{copy.workspace}</span>
          <strong>{shortPath(bootstrap.workspace.root)}</strong>
        </div>
        <span className="local-pill">{copy.localFirst}</span>
      </div>
    </nav>
  );
}

function shortPath(value: string): string {
  const parts = value.split("/").filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : value;
}
