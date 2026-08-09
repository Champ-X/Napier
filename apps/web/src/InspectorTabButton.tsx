import type { KeyboardEvent, ReactNode } from "react";

import type { InspectorTab } from "./use-workspace-view-model";

export function InspectorTabButton({
  id,
  active,
  tabbable,
  icon,
  children,
  onClick,
  onKeyDown,
}: {
  id: InspectorTab;
  active: boolean;
  tabbable: boolean;
  icon: ReactNode;
  children: ReactNode;
  onClick: (id: InspectorTab) => void;
  onKeyDown: (
    event: KeyboardEvent<HTMLButtonElement>,
    id: InspectorTab,
  ) => void;
}) {
  return (
    <button
      id={`inspector-tab-${id}`}
      type="button"
      role="tab"
      data-inspector-tab={id}
      aria-controls="inspector-active-panel"
      aria-selected={active}
      tabIndex={tabbable ? 0 : -1}
      className={active ? "is-active" : ""}
      onClick={() => onClick(id)}
      onKeyDown={(event) => onKeyDown(event, id)}
    >
      {icon}
      {children}
    </button>
  );
}
