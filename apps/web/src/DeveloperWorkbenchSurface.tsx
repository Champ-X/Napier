import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import { AgentPackagePublishingSurface } from "./AgentPackagePublishingSurface";
import { copy } from "./copy";
import {
  DEVELOPER_WORKBENCH_SECTIONS,
  moveDeveloperWorkbenchSection,
  type DeveloperWorkbenchSection,
} from "./developer-workbench-section-registry";
import { DesignSystemShowcase } from "./DesignSystemShowcase";
import { DeveloperToolsPanel } from "./DeveloperToolsPanel";
import { WorkspaceAutomationSettings } from "./WorkspaceAutomationSettings";
import { recentModelKeysFromRuns } from "./model-selection-view-model";
import type { useWorkspaceViewModel } from "./use-workspace-view-model";

const LazyPublishing = lazy(() =>
  import("./ExtensionPublishingSurface").then(
    ({ ExtensionPublishingSurface }) => ({
      default: ExtensionPublishingSurface,
    }),
  ),
);
type WorkspaceViewModel = ReturnType<typeof useWorkspaceViewModel>;

export interface DeveloperWorkbenchSurfaceProps {
  vm: WorkspaceViewModel;
  activeAgent: NonNullable<WorkspaceViewModel["detail"]>["agent"] | undefined;
  section: DeveloperWorkbenchSection;
  onSection(section: DeveloperWorkbenchSection): void;
  onClose(): void;
  onConversation(): void;
}

export function DeveloperWorkbenchSurface({
  vm,
  activeAgent,
  section,
  onSection,
  onClose,
  onConversation,
}: DeveloperWorkbenchSurfaceProps) {
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const surfaceRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLElement | null>(null);
  const [developerToolsVisited, setDeveloperToolsVisited] = useState(
    section === "lab",
  );
  useEffect(() => {
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (
        event.key === "Escape" &&
        surfaceRef.current?.querySelector('[role="dialog"]')
      ) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !surfaceRef.current) return;
      const focusable = focusableElements(surfaceRef.current);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      restoreFocusRef.current?.focus();
    };
  }, [onClose]);
  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
    const focusTimer = window.setTimeout(() => {
      document.getElementById(`developer-section-${section}`)?.focus();
    }, 120);
    return () => window.clearTimeout(focusTimer);
  }, [section]);
  useEffect(() => {
    if (section === "lab") setDeveloperToolsVisited(true);
  }, [section]);

  return (
    <>
      <button
        type="button"
        className="workspace-settings-backdrop"
        tabIndex={-1}
        aria-label={copy.developerWorkbench.close}
        onClick={onClose}
      />
      <aside
        ref={surfaceRef}
        className="workspace-settings-surface developer-workbench-surface"
        role="dialog"
        aria-modal="true"
        aria-labelledby="developer-workbench-title"
      >
        <header className="settings-surface-heading">
          <div>
            <span>{copy.developerWorkbench.eyebrow}</span>
            <h2 id="developer-workbench-title">
              {copy.developerWorkbench.title}
            </h2>
            <p>{copy.developerWorkbench.body}</p>
          </div>
          <button
            type="button"
            aria-label={copy.developerWorkbench.close}
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <nav
          className="settings-navigation"
          aria-label={copy.developerWorkbench.sectionsLabel}
          role="tablist"
        >
          {DEVELOPER_WORKBENCH_SECTIONS.map((entry) => {
            const Icon = entry.icon;
            return (
              <button
                id={`developer-section-${entry.id}`}
                type="button"
                className={section === entry.id ? "is-active" : ""}
                role="tab"
                aria-selected={section === entry.id}
                aria-controls="developer-workbench-content"
                tabIndex={section === entry.id ? 0 : -1}
                key={entry.id}
                onClick={() => onSection(entry.id)}
                onKeyDown={(event) =>
                  moveDeveloperWorkbenchSection(event, entry.id, onSection)
                }
              >
                <Icon size={15} aria-hidden="true" />
                <span>
                  <strong>{entry.label}</strong>
                  <small>{entry.description}</small>
                </span>
              </button>
            );
          })}
        </nav>
        <section
          ref={contentRef}
          id="developer-workbench-content"
          className="settings-content"
          role="tabpanel"
          aria-labelledby={`developer-section-${section}`}
        >
          {section === "automations" ? (
            <WorkspaceAutomationSettings vm={vm} />
          ) : null}
          {section === "lab" || developerToolsVisited ? (
            <DeveloperToolsPanel
              vm={vm}
              activeModel={vm.selectedModel}
              onConversation={onConversation}
              hidden={section !== "lab"}
            />
          ) : null}
          {section === "publishing" && vm.bootstrap ? (
            <>
              <Suspense
                fallback={<div className="context-loading" role="status" />}
              >
                <LazyPublishing vm={vm} />
              </Suspense>
              {activeAgent && vm.detail ? (
                <AgentPackagePublishingSurface
                  agent={activeAgent}
                  workspace={vm.bootstrap.workspace.root}
                  skills={vm.bootstrap.skills}
                  models={vm.bootstrap.models}
                  credentials={vm.bootstrap.credentials}
                  publisherAnchors={vm.bootstrap.extensionPublisherTrustAnchors}
                  skillPackageInstallations={
                    vm.bootstrap.skillPackageInstallations
                  }
                  usagePriceTableCatalog={vm.bootstrap.usagePriceTableCatalog}
                  threadId={vm.detail.thread.id}
                  selectedModelKey={vm.selectedModelKey}
                  recentModelKeys={recentModelKeysFromRuns(vm.detail.runs)}
                  onModel={vm.setSelectedModelKey}
                  onAgentUpdated={vm.commitAgentConfiguration}
                  onBootstrapUpdated={vm.commitConfigurationBootstrap}
                />
              ) : null}
            </>
          ) : null}
          {section === "design" ? <DesignSystemShowcase /> : null}
        </section>
      </aside>
    </>
  );
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return [
    ...container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), details > summary, [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((element) => element.getClientRects().length > 0);
}
