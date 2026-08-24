import { useEffect, useId, useRef } from "react";
import { ChevronLeft, ChevronRight, Menu, Plus, Settings2 } from "lucide-react";

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
  onOpenSettings(): void;
}) {
  const { collapsed, overlay, navOpen, toggleSidebar, closeNav } =
    useWorkspaceLayout();
  const navId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const restoreFocusRef = useRef(false);

  // Overlay focus management (design §18.3): move focus into the drawer when it
  // opens, return it to the trigger when it closes, and let Escape dismiss it.
  useEffect(() => {
    if (!overlay) return;
    if (navOpen) {
      const focusTimer = window.setTimeout(() => {
        navRef.current
          ?.querySelector<HTMLButtonElement>("button")
          ?.focus();
      }, 180);
      const closeOnEscape = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          restoreFocusRef.current = true;
          closeNav();
        }
      };
      window.addEventListener("keydown", closeOnEscape);
      return () => {
        window.clearTimeout(focusTimer);
        window.removeEventListener("keydown", closeOnEscape);
      };
    }
    if (restoreFocusRef.current) {
      restoreFocusRef.current = false;
      triggerRef.current?.focus();
    }
    return undefined;
  }, [overlay, navOpen, closeNav]);

  const dismissAfter = (run: () => void) => {
    run();
    if (overlay) {
      restoreFocusRef.current = false;
      closeNav();
    }
  };

  const navHidden = overlay && !navOpen;
  return (
    <>
      {overlay ? (
        <button
          ref={triggerRef}
          className="ledger-nav-trigger"
          type="button"
          aria-label={copy.recentThreads}
          aria-controls={navId}
          aria-expanded={navOpen}
          onClick={toggleSidebar}
        >
          <Menu size={16} aria-hidden="true" />
        </button>
      ) : null}
      {overlay && navOpen ? (
        <button
          className="ledger-nav-backdrop"
          type="button"
          aria-label="关闭会话导航"
          onClick={() => {
            restoreFocusRef.current = true;
            closeNav();
          }}
        />
      ) : null}
      <nav
        ref={navRef}
        id={navId}
        className={`ledger-nav${collapsed ? " is-collapsed" : ""}${
          overlay ? " is-overlay" : ""
        }${navOpen ? " is-open" : ""}`}
        aria-label={copy.recentThreads}
        aria-hidden={navHidden || undefined}
        inert={navHidden}
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
          onClick={() => dismissAfter(onNewThread)}
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
          onSelect={(threadId) => dismissAfter(() => onSelect(threadId))}
          onTrash={onTrash}
          onRestore={onRestore}
          onWorkspaceSwitch={onWorkspaceSwitch}
          onOpenWorkspaceSettings={onOpenWorkspaceSettings}
        />

        <button
          className="workspace-settings-button"
          type="button"
          aria-label={copy.settings}
          onClick={() => dismissAfter(onOpenSettings)}
        >
          <Settings2 size={14} aria-hidden="true" />
          <span>{copy.settings}</span>
        </button>
      </nav>
    </>
  );
}
