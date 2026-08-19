import { lazy, Suspense, useEffect, useRef } from "react";
import { X } from "lucide-react";

import { copy } from "./copy";
import { DeveloperToolsPanel } from "./DeveloperToolsPanel";
import { DesignSystemShowcase } from "./DesignSystemShowcase";
import { ExtensionInspectorSurface } from "./ExtensionInspectorSurface";
import {
  moveSettingsSection,
  SETTINGS_SECTIONS,
} from "./settings-section-registry";
import type { SettingsSection } from "./settings-section-registry";
import { SettingsLanguagePanel } from "./SettingsLanguagePanel";
import { WorkspaceRootPanel } from "./WorkspaceRootPanel";
import { WorkspaceAutomationSettings } from "./WorkspaceAutomationSettings";
import type { useWorkspaceViewModel } from "./use-workspace-view-model";

const LazyContextPanel = lazy(() => import("./ContextPanel"));
const LazyMemoryPanel = lazy(() => import("./MemoryPanel"));

type WorkspaceViewModel = ReturnType<typeof useWorkspaceViewModel>;
export type { SettingsSection } from "./settings-section-registry";

export interface WorkspaceSettingsSurfaceProps {
  vm: WorkspaceViewModel;
  activeAgent: NonNullable<WorkspaceViewModel["detail"]>["agent"] | undefined;
  section: SettingsSection;
  onSection(section: SettingsSection): void;
  onClose(): void;
  onWorkspaceSwitch(root: string): Promise<void>;
  onConversation(): void;
}

export function WorkspaceSettingsSurface({
  vm,
  activeAgent,
  section,
  onSection,
  onClose,
  onWorkspaceSwitch,
  onConversation,
}: WorkspaceSettingsSurfaceProps) {
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const surfaceRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const handleKeyDown = (event: KeyboardEvent) => {
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
    const focusTimer = window.setTimeout(() => {
      document.getElementById(`settings-section-${section}`)?.focus();
    }, 120);
    return () => window.clearTimeout(focusTimer);
  }, [section]);

  return (
    <>
      <button
        type="button"
        className="workspace-settings-backdrop"
        aria-label={copy.settingsSurface.close}
        onClick={onClose}
      />
      <aside
        ref={surfaceRef}
        className="workspace-settings-surface"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-surface-title"
      >
        <header className="settings-surface-heading">
          <div>
            <span>{copy.settingsSurface.eyebrow}</span>
            <h2 id="settings-surface-title">{copy.settingsSurface.title}</h2>
            <p>{copy.settingsSurface.body}</p>
          </div>
          <button
            type="button"
            aria-label={copy.settingsSurface.close}
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <nav
          className="settings-navigation"
          aria-label={copy.settingsSurface.sectionsLabel}
          role="tablist"
        >
          {SETTINGS_SECTIONS.map((entry) => {
            const Icon = entry.icon;
            return (
              <button
                id={`settings-section-${entry.id}`}
                type="button"
                className={section === entry.id ? "is-active" : ""}
                role="tab"
                aria-selected={section === entry.id}
                aria-controls="settings-content-panel"
                tabIndex={section === entry.id ? 0 : -1}
                key={entry.id}
                onClick={() => onSection(entry.id)}
                onKeyDown={(event) =>
                  moveSettingsSection(event, entry.id, onSection)
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
          id="settings-content-panel"
          className="settings-content"
          role="tabpanel"
          aria-labelledby={`settings-section-${section}`}
        >
          {section === "context" && activeAgent && vm.bootstrap && vm.detail ? (
            <Suspense fallback={<Loading label={copy.context.loading} />}>
              <LazyContextPanel
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
                onModel={vm.setSelectedModelKey}
                onAgentUpdated={vm.commitAgentConfiguration}
                onBootstrapUpdated={vm.commitConfigurationBootstrap}
                {...(vm.contextCheckpointCalibration
                  ? {
                      checkpointCalibration: vm.contextCheckpointCalibration,
                    }
                  : {})}
                {...(vm.contextCheckpoint
                  ? { checkpoint: vm.contextCheckpoint }
                  : {})}
              />
            </Suspense>
          ) : null}
          {section === "memory" && vm.bootstrap ? (
            <Suspense fallback={<Loading label={copy.memory.loading} />}>
              <LazyMemoryPanel
                memories={vm.bootstrap.memories.filter(
                  (memory) =>
                    memory.scope === "workspace" ||
                    memory.agentId === activeAgent?.id,
                )}
                draft={vm.memoryDraft}
                category={vm.memoryCategory}
                scope={vm.memoryScope}
                reviewIntervalDays={vm.memoryReviewIntervalDays}
                supersedesMemoryId={vm.memorySupersedesId}
                consolidatesMemoryIds={vm.memoryConsolidatesIds}
                onDraft={vm.setMemoryDraft}
                onCategory={vm.setMemoryCategory}
                onScope={vm.setMemoryScope}
                onReviewIntervalDays={vm.setMemoryReviewIntervalDays}
                onSave={() => void vm.saveMemory()}
                onCorrect={vm.startMemoryCorrection}
                onCancelCorrection={vm.cancelMemoryCorrection}
                onToggleConsolidation={vm.toggleMemoryConsolidation}
                onCancelConsolidation={vm.cancelMemoryConsolidation}
                onReview={(memoryId, action) =>
                  void vm.reviewMemoryFact(memoryId, action)
                }
              />
            </Suspense>
          ) : null}
          {section === "extensions" && activeAgent ? (
            <ExtensionInspectorSurface vm={vm} agentId={activeAgent.id} />
          ) : null}
          {section === "workspace" && vm.bootstrap ? (
            <WorkspaceRootPanel
              root={vm.bootstrap.workspace.root}
              dataRoot={vm.bootstrap.workspace.dataRoot}
              onWorkspaceSwitch={onWorkspaceSwitch}
            />
          ) : null}
          {section === "automations" ? (
            <WorkspaceAutomationSettings vm={vm} />
          ) : null}
          {section === "developer" ? (
            <DeveloperToolsPanel
              vm={vm}
              activeModel={vm.selectedModel}
              onConversation={onConversation}
            />
          ) : null}
          {section === "design" ? <DesignSystemShowcase /> : null}
          {section === "language" ? <SettingsLanguagePanel /> : null}
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

function Loading({ label }: { label: string }) {
  return (
    <div className="context-loading" role="status">
      {label}
    </div>
  );
}
