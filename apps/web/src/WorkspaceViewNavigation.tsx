import { Activity, Layers3, MessageSquareText } from "lucide-react";
import type { KeyboardEvent } from "react";

import { copy } from "./copy";

export type WorkspaceView = "conversation" | "trace" | "session";

const VIEWS: ReadonlyArray<{
  id: WorkspaceView;
  label: string;
  icon: typeof Activity;
}> = [
  {
    id: "conversation",
    label: copy.tabs.conversation,
    icon: MessageSquareText,
  },
  {
    id: "trace",
    label: copy.tabs.trace,
    icon: Activity,
  },
  {
    id: "session",
    label: copy.tabs.session,
    icon: Layers3,
  },
];

export function WorkspaceViewNavigation({
  activeView,
  eventCount,
  runCount,
  onChange,
}: {
  activeView: WorkspaceView;
  eventCount: number;
  runCount: number;
  onChange(view: WorkspaceView): void;
}) {
  return (
    <nav className="workspace-view-navigation" aria-label="Workspace views">
      <div className="workspace-view-tabs" role="tablist">
        {VIEWS.map((view) => {
          const Icon = view.icon;
          const count =
            view.id === "trace"
              ? eventCount
              : view.id === "session"
                ? runCount
                : undefined;
          return (
            <button
              id={`workspace-view-${view.id}`}
              className={activeView === view.id ? "is-active" : ""}
              type="button"
              role="tab"
              aria-selected={activeView === view.id}
              aria-controls={`workspace-panel-${view.id}`}
              tabIndex={activeView === view.id ? 0 : -1}
              key={view.id}
              onClick={() => onChange(view.id)}
              onKeyDown={(event) => moveWorkspaceView(event, view.id, onChange)}
            >
              <Icon size={14} aria-hidden="true" />
              <strong>{view.label}</strong>
              {count !== undefined ? <i>{compactCount(count)}</i> : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function compactCount(value: number): string {
  return value > 999 ? `${(value / 1_000).toFixed(1)}k` : String(value);
}

function moveWorkspaceView(
  event: KeyboardEvent<HTMLButtonElement>,
  current: WorkspaceView,
  onChange: (view: WorkspaceView) => void,
): void {
  const index = VIEWS.findIndex((view) => view.id === current);
  const next =
    event.key === "ArrowRight"
      ? (index + 1) % VIEWS.length
      : event.key === "ArrowLeft"
        ? (index - 1 + VIEWS.length) % VIEWS.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? VIEWS.length - 1
            : undefined;
  if (next === undefined) return;
  event.preventDefault();
  const view = VIEWS[next]!;
  onChange(view.id);
  requestAnimationFrame(() =>
    document.getElementById(`workspace-view-${view.id}`)?.focus(),
  );
}
