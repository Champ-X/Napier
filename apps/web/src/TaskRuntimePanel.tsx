import { Box, Globe2, TerminalSquare } from "lucide-react";
import { lazy, Suspense } from "react";

import { copy } from "./copy";
import { KernelPluginInspectorSlots } from "./KernelPluginInspectorSlots";
import type { TaskRuntimeAvailability } from "./task-runtime-view-model";
import type { useWorkspaceViewModel } from "./use-workspace-view-model";

const LazyProcessPanel = lazy(() => import("./ProcessPanel"));
type WorkspaceViewModel = ReturnType<typeof useWorkspaceViewModel>;

export function TaskRuntimePanel({
  vm,
  activeModel,
  availability,
}: {
  vm: WorkspaceViewModel;
  activeModel: WorkspaceViewModel["selectedModel"];
  availability: TaskRuntimeAvailability;
}) {
  return (
    <section className="task-panel task-runtime" aria-labelledby="task-runtime-title">
      <header className="task-panel-heading">
        <div>
          <span>{copy.taskView.sections.environment}</span>
          <h2 id="task-runtime-title">{copy.taskView.environment.title}</h2>
          <p>{copy.taskView.environment.body}</p>
        </div>
      </header>
      {!availability.browser && !availability.process && !availability.sandbox ? (
        <p className="task-empty-state">{copy.taskView.environment.empty}</p>
      ) : null}
      {availability.browser ? (
        <section className="task-runtime-card">
          <h3>
            <Globe2 size={16} aria-hidden="true" />
            {copy.taskView.environment.browser}
          </h3>
          <KernelPluginInspectorSlots
            plugins={vm.bootstrap?.plugins}
            activeTab="browser"
            browser={{
              events: vm.detail?.events ?? [],
              activeRunId: vm.activeRunId,
              taskContext: {
                models: vm.bootstrap?.models ?? [],
                credentials: vm.bootstrap?.credentials ?? [],
                selectedModel: activeModel,
              },
            }}
          />
        </section>
      ) : null}
      {availability.process && vm.detail ? (
        <section className="task-runtime-card">
          <h3>
            <TerminalSquare size={16} aria-hidden="true" />
            {copy.taskView.environment.process}
          </h3>
          <Suspense fallback={<div className="context-loading" role="status" />}>
            <LazyProcessPanel
              threadId={vm.detail.thread.id}
              onThreadChanged={vm.refreshActiveThread}
            />
          </Suspense>
        </section>
      ) : null}
      {availability.sandbox ? (
        <section className="task-runtime-card is-compact">
          <Box size={17} aria-hidden="true" />
          <div>
            <strong>{copy.taskView.environment.sandbox}</strong>
            <p>{copy.taskView.environment.body}</p>
          </div>
        </section>
      ) : null}
    </section>
  );
}
