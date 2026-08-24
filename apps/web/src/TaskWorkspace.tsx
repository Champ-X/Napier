import { BadgeCheck, FileDiff, LayoutList, TerminalSquare } from "lucide-react";
import { useEffect } from "react";
import type { KeyboardEvent } from "react";

import { copy } from "./copy";
import { TaskChangesPanel } from "./TaskChangesPanel";
import { TaskOverviewPanel } from "./TaskOverviewPanel";
import { TaskRuntimePanel } from "./TaskRuntimePanel";
import {
  hasTaskRuntime,
  taskRuntimeAvailability,
} from "./task-runtime-view-model";
import { TaskValidationPanel } from "./TaskValidationPanel";
import type { useWorkspaceViewModel } from "./use-workspace-view-model";

type WorkspaceViewModel = ReturnType<typeof useWorkspaceViewModel>;
export type TaskSection =
  | "overview"
  | "changes"
  | "environment"
  | "validation";

const BASE_SECTIONS = [
  { id: "overview", icon: LayoutList },
  { id: "changes", icon: FileDiff },
  { id: "environment", icon: TerminalSquare },
  { id: "validation", icon: BadgeCheck },
] as const;

export function TaskWorkspace({
  vm,
  section,
  activeModel,
  onSection,
  onOpenConversation,
}: {
  vm: WorkspaceViewModel;
  section: TaskSection;
  activeModel: WorkspaceViewModel["selectedModel"];
  onSection(section: TaskSection): void;
  onOpenConversation(): void;
}) {
  const availability = taskRuntimeAvailability(
    vm.detail?.events ?? [],
    vm.activeRunId,
  );
  const runtimeVisible = hasTaskRuntime(availability);
  const sections = BASE_SECTIONS.filter((entry) =>
    taskSectionIds(runtimeVisible).includes(entry.id),
  );
  useEffect(() => {
    if (section === "environment" && !runtimeVisible) onSection("overview");
  }, [onSection, runtimeVisible, section]);

  return (
    <div className="task-workspace">
      <header className="task-workspace-heading">
        <span>{copy.taskView.eyebrow}</span>
        <h1>{copy.taskView.title}</h1>
        <p>{copy.taskView.body}</p>
      </header>
      <nav
        className="task-section-navigation"
        aria-label={copy.taskView.title}
        role="tablist"
      >
        {sections.map((entry) => {
          const Icon = entry.icon;
          return (
            <button
              id={`task-section-${entry.id}`}
              type="button"
              className={section === entry.id ? "is-active" : ""}
              role="tab"
              aria-selected={section === entry.id}
              aria-controls="task-content-panel"
              tabIndex={section === entry.id ? 0 : -1}
              key={entry.id}
              onClick={() => onSection(entry.id)}
              onKeyDown={(event) =>
                moveTaskSection(event, entry.id, sections, onSection)
              }
            >
              <Icon size={15} aria-hidden="true" />
              {copy.taskView.sections[entry.id]}
            </button>
          );
        })}
      </nav>
      <div
        id="task-content-panel"
        className="task-content-surface"
        role="tabpanel"
        aria-labelledby={`task-section-${section}`}
      >
        {section === "overview" ? (
          <TaskOverviewPanel
            detail={vm.detail}
            goal={vm.activeGoal}
            goalDraft={vm.goalDraft}
            modelConfigured={activeModel.configured}
            decision={vm.openOperatorDecision}
            onGoalDraft={vm.setGoalDraft}
            onGoalSave={() => void vm.saveGoal()}
            onGoalClear={() => void vm.removeGoal()}
            onContinue={() => void vm.submit(copy.planNextPrompt)}
            onReviewDecision={onOpenConversation}
          />
        ) : null}
        {section === "changes" ? <TaskChangesPanel detail={vm.detail} /> : null}
        {section === "environment" && runtimeVisible ? (
          <TaskRuntimePanel
            vm={vm}
            activeModel={activeModel}
            availability={availability}
          />
        ) : null}
        {section === "validation" ? (
          <TaskValidationPanel detail={vm.detail} />
        ) : null}
      </div>
    </div>
  );
}

export function taskSectionIds(runtimeVisible: boolean): TaskSection[] {
  return runtimeVisible
    ? ["overview", "changes", "environment", "validation"]
    : ["overview", "changes", "validation"];
}

function moveTaskSection(
  event: KeyboardEvent<HTMLButtonElement>,
  current: TaskSection,
  sections: ReadonlyArray<(typeof BASE_SECTIONS)[number]>,
  onSection: (section: TaskSection) => void,
) {
  const index = sections.findIndex((entry) => entry.id === current);
  const next =
    event.key === "ArrowRight"
      ? (index + 1) % sections.length
      : event.key === "ArrowLeft"
        ? (index - 1 + sections.length) % sections.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? sections.length - 1
            : undefined;
  if (next === undefined) return;
  event.preventDefault();
  const target = sections[next]!;
  onSection(target.id);
  requestAnimationFrame(() =>
    document.getElementById(`task-section-${target.id}`)?.focus(),
  );
}
