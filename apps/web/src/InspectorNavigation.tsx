import {
  Activity,
  Brain,
  Cable,
  CalendarClock,
  ClipboardList,
  Command,
  FolderArchive,
  Layers,
  Scale,
  Search,
  Target,
} from "lucide-react";

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

export function InspectorNavigation({
  activeTab,
  onChange,
}: {
  activeTab: InspectorTab;
  onChange: (tab: InspectorTab) => void;
}) {
  const activeGroup = inspectorGroup(activeTab);
  const visibleTabs = inspectorTabs(activeTab);

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
              key={group.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={active ? "is-active" : ""}
              onClick={() => onChange(group.defaultTab)}
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
              icon={<Icon size={14} />}
              onClick={onChange}
            >
              {copy.tabs[tab]}
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
