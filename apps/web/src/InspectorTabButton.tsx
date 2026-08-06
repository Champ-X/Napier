import type { ReactNode } from "react";

import type { InspectorTab } from "./use-workspace-view-model";

export function InspectorTabButton({
  id,
  active,
  icon,
  children,
  onClick,
}: {
  id: InspectorTab;
  active: boolean;
  icon: ReactNode;
  children: ReactNode;
  onClick: (id: InspectorTab) => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      data-inspector-tab={id}
      aria-selected={active}
      className={active ? "is-active" : ""}
      onClick={() => onClick(id)}
    >
      {icon}
      {children}
    </button>
  );
}
