import {
  Activity,
  Brain,
  Cable,
  CalendarClock,
  ClipboardList,
  Command,
  FolderArchive,
  Globe,
  Layers,
  Scale,
  Search,
  Target,
} from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { useEffect, useState } from "react";

import { copy } from "./copy";
import { InspectorTabButton } from "./InspectorTabButton";
import type { InspectorTab } from "./use-workspace-view-model";

export type InspectorGroupId = "activity" | "files" | "inspect";

export const INSPECTOR_GROUPS: ReadonlyArray<{
  id: InspectorGroupId;
  label: string;
  icon: typeof Activity;
  defaultTab: InspectorTab;
  tabs: readonly InspectorTab[];
}> = [
  {
    id: "activity",
    label: "Activity/Plan",
    icon: Activity,
    defaultTab: "plan",
    tabs: ["plan", "goal"],
  },
  {
    id: "files",
    label: "Files/Artifacts",
    icon: FolderArchive,
    defaultTab: "files",
    tabs: ["files"],
  },
  {
    id: "inspect",
    label: "Inspect",
    icon: Search,
    defaultTab: "context",
    tabs: [
      "context",
      "browser",
      "trace",
      "processes",
      "lab",
      "memory",
      "extensions",
      "automations",
    ],
  },
];

const TAB_ICONS: Record<InspectorTab, typeof Activity> = {
  browser: Globe,
  trace: Activity,
  processes: Command,
  files: FolderArchive,
  lab: Scale,
  plan: ClipboardList,
  goal: Target,
  memory: Brain,
  extensions: Cable,
  automations: CalendarClock,
  context: Layers,
};
const TAB_LABELS: Record<InspectorTab, string> = {
  ...copy.tabs,
  browser: "Browser",
};

export function InspectorNavigation({
  activeTab,
  onChange,
}: {
  activeTab: InspectorTab;
  onChange: (tab: InspectorTab) => void;
}) {
  const activeGroup = inspectorGroup(activeTab);
  const visibleTabs = inspectorTabs(activeTab);
  const [focusedGroup, setFocusedGroup] = useState(activeGroup.id);
  const [focusedTool, setFocusedTool] = useState(activeTab);
  useEffect(() => {
    setFocusedGroup(activeGroup.id);
    setFocusedTool(activeTab);
  }, [activeGroup.id, activeTab]);

  return (
    <nav className="inspector-navigation" aria-label="Inspector navigation">
      <div
        className="inspector-groups"
        role="tablist"
        aria-label="Inspector sections"
      >
        {INSPECTOR_GROUPS.map((group) => {
          const Icon = group.icon;
          const active = group.id === activeGroup.id;
          return (
            <button
              id={`inspector-group-${group.id}`}
              key={group.id}
              type="button"
              role="tab"
              aria-controls="inspector-active-panel"
              aria-selected={active}
              tabIndex={focusedGroup === group.id ? 0 : -1}
              className={active ? "is-active" : ""}
              onClick={() => onChange(group.defaultTab)}
              onKeyDown={(event) =>
                moveGroupFocus(event, group.id, setFocusedGroup)
              }
            >
              <Icon size={13} aria-hidden="true" />
              {group.label}
            </button>
          );
        })}
      </div>
      <div
        className="inspector-tabs"
        role="tablist"
        aria-label={`${activeGroup.label} tools`}
      >
        {visibleTabs.map((tab) => {
          const Icon = TAB_ICONS[tab];
          return (
            <InspectorTabButton
              key={tab}
              id={tab}
              active={activeTab === tab}
              tabbable={focusedTool === tab}
              icon={<Icon size={14} />}
              onClick={onChange}
              onKeyDown={(event, id) =>
                moveToolFocus(event, id, visibleTabs, setFocusedTool)
              }
            >
              {TAB_LABELS[tab]}
            </InspectorTabButton>
          );
        })}
      </div>
    </nav>
  );
}

export function inspectorGroup(activeTab: InspectorTab) {
  return (
    INSPECTOR_GROUPS.find((group) => group.tabs.includes(activeTab)) ??
    INSPECTOR_GROUPS[0]!
  );
}

export function inspectorTabs(
  activeTab: InspectorTab,
): readonly InspectorTab[] {
  const group = inspectorGroup(activeTab);
  return [activeTab, ...group.tabs.filter((tab) => tab !== activeTab)];
}

export function InspectorPanel({
  activeTab,
  children,
}: {
  activeTab: InspectorTab;
  children: ReactNode;
}) {
  return (
    <div
      id="inspector-active-panel"
      className="inspector-body"
      role="tabpanel"
      aria-labelledby={`inspector-tab-${activeTab}`}
    >
      {children}
    </div>
  );
}

export function adjacentIndex(
  current: number,
  length: number,
  key: string,
): number | undefined {
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  if (key === "ArrowRight" || key === "ArrowDown") {
    return (current + 1) % length;
  }
  if (key === "ArrowLeft" || key === "ArrowUp") {
    return (current - 1 + length) % length;
  }
  return undefined;
}

function moveGroupFocus(
  event: KeyboardEvent<HTMLButtonElement>,
  currentId: InspectorGroupId,
  setFocused: (group: InspectorGroupId) => void,
): void {
  const current = INSPECTOR_GROUPS.findIndex((group) => group.id === currentId);
  const next = adjacentIndex(current, INSPECTOR_GROUPS.length, event.key);
  if (next === undefined) return;
  event.preventDefault();
  const group = INSPECTOR_GROUPS[next]!;
  setFocused(group.id);
  requestAnimationFrame(() =>
    document.getElementById(`inspector-group-${group.id}`)?.focus(),
  );
}

function moveToolFocus(
  event: KeyboardEvent<HTMLButtonElement>,
  currentId: InspectorTab,
  tabs: readonly InspectorTab[],
  setFocused: (tab: InspectorTab) => void,
): void {
  const current = tabs.indexOf(currentId);
  const next = adjacentIndex(current, tabs.length, event.key);
  if (next === undefined) return;
  event.preventDefault();
  const tab = tabs[next]!;
  setFocused(tab);
  requestAnimationFrame(() =>
    document.getElementById(`inspector-tab-${tab}`)?.focus(),
  );
}
