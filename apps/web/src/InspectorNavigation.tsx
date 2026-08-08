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

type InspectorGroupId = "activity" | "files" | "inspect";

const GROUPS: ReadonlyArray<{
  id: InspectorGroupId;
  label: string;
  icon: typeof Activity;
  defaultTab: InspectorTab;
  tabs: readonly InspectorTab[];
}> = [
  {
    id: "activity",
    label: "Activity",
    icon: Activity,
    defaultTab: "trace",
    tabs: ["trace", "processes", "plan", "goal"],
  },
  {
    id: "files",
    label: "Files",
    icon: FolderArchive,
    defaultTab: "files",
    tabs: ["files", "lab"],
  },
  {
    id: "inspect",
    label: "Inspect",
    icon: Search,
    defaultTab: "context",
    tabs: ["context", "memory", "extensions", "automations"],
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
  const activeGroup =
    GROUPS.find((group) => group.tabs.includes(activeTab)) ?? GROUPS[0]!;

  return (
    <nav className="inspector-navigation" aria-label="Inspector navigation">
      <div className="inspector-groups" role="tablist" aria-label="Inspector sections">
        {GROUPS.map((group) => {
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
      <div className="inspector-tabs" role="tablist" aria-label={`${activeGroup.label} tools`}>
        {activeGroup.tabs.map((tab) => {
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
