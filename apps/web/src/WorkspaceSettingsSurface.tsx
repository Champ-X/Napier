import { lazy, Suspense, useEffect, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { Bot, Brain, Cable, FolderTree, Languages, Settings2, X } from "lucide-react";

import { copy } from "./copy";
import { getLocale, setLocale } from "./locale";
import { ExtensionInspectorSurface } from "./ExtensionInspectorSurface";
import { WorkspaceRootPanel } from "./WorkspaceRootPanel";
import type { useWorkspaceViewModel } from "./use-workspace-view-model";

const LazyContextPanel = lazy(() => import("./ContextPanel"));
const LazyMemoryPanel = lazy(() => import("./MemoryPanel"));

type WorkspaceViewModel = ReturnType<typeof useWorkspaceViewModel>;
export type SettingsSection =
  | "context"
  | "memory"
  | "extensions"
  | "workspace"
  | "language";

const SETTINGS_SECTIONS: ReadonlyArray<{
  id: SettingsSection;
  label: string;
  description: string;
  icon: typeof Settings2;
}> = [
  {
    id: "context",
    label: "Agent & Model",
    description: "Providers, policies, skills and credentials",
    icon: Bot,
  },
  {
    id: "memory",
    label: "Memory",
    description: "Workspace knowledge and review cadence",
    icon: Brain,
  },
  {
    id: "extensions",
    label: "Extensions",
    description: "MCP, packages and trust",
    icon: Cable,
  },
  {
    id: "workspace",
    label: copy.workspaceSurface.section,
    description: copy.workspaceSurface.sectionDescription,
    icon: FolderTree,
  },
  {
    id: "language",
    label: copy.language.section,
    description: copy.language.sectionDescription,
    icon: Languages,
  },
];

export function WorkspaceSettingsSurface({
  vm,
  activeAgent,
  section,
  onSection,
  onClose,
}: {
  vm: WorkspaceViewModel;
  activeAgent: NonNullable<WorkspaceViewModel["detail"]>["agent"] | undefined;
  section: SettingsSection;
  onSection(section: SettingsSection): void;
  onClose(): void;
}) {
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("keydown", close);
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
        aria-label="Close Settings"
        onClick={onClose}
      />
      <aside className="workspace-settings-surface" aria-label="Settings">
        <header className="settings-surface-heading">
          <div>
            <span>Workspace configuration</span>
            <h2>Settings</h2>
            <p>
              Configuration that survives beyond a single conversation or Run.
            </p>
          </div>
          <button type="button" aria-label="Close Settings" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <nav
          className="settings-navigation"
          aria-label="Settings sections"
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
            />
          ) : null}
          {section === "language" ? <LanguagePanel /> : null}
        </section>
      </aside>
    </>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div className="context-loading" role="status">
      {label}
    </div>
  );
}

function LanguagePanel() {
  const current = getLocale();
  const options: Array<{ id: "zh" | "en"; label: string }> = [
    { id: "zh", label: copy.language.chinese },
    { id: "en", label: copy.language.english },
  ];
  return (
    <div className="language-panel">
      <p className="language-panel-current">
        {copy.language.current}: <strong>{options.find((o) => o.id === current)?.label}</strong>
      </p>
      <div className="language-panel-options">
        {options.map((option) => (
          <button
            type="button"
            key={option.id}
            className={option.id === current ? "is-active" : ""}
            aria-pressed={option.id === current}
            onClick={() => {
              if (option.id !== current) setLocale(option.id);
            }}
          >
            <Languages size={14} aria-hidden="true" />
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function moveSettingsSection(
  event: ReactKeyboardEvent<HTMLButtonElement>,
  current: SettingsSection,
  onSection: (section: SettingsSection) => void,
): void {
  const index = SETTINGS_SECTIONS.findIndex((entry) => entry.id === current);
  const next =
    event.key === "ArrowDown" || event.key === "ArrowRight"
      ? (index + 1) % SETTINGS_SECTIONS.length
      : event.key === "ArrowUp" || event.key === "ArrowLeft"
        ? (index - 1 + SETTINGS_SECTIONS.length) % SETTINGS_SECTIONS.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? SETTINGS_SECTIONS.length - 1
            : undefined;
  if (next === undefined) return;
  event.preventDefault();
  const section = SETTINGS_SECTIONS[next]!;
  onSection(section.id);
  requestAnimationFrame(() =>
    document.getElementById(`settings-section-${section.id}`)?.focus(),
  );
}
