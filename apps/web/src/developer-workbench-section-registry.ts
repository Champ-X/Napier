import type { KeyboardEvent } from "react";
import { CalendarClock, FlaskConical, PackageCheck, Palette } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { copy } from "./copy";

export type DeveloperWorkbenchSection =
  | "automations"
  | "lab"
  | "publishing"
  | "design";

export interface DeveloperWorkbenchSectionDefinition {
  id: DeveloperWorkbenchSection;
  label: string;
  description: string;
  icon: LucideIcon;
}

export const DEVELOPER_WORKBENCH_SECTIONS: ReadonlyArray<DeveloperWorkbenchSectionDefinition> =
  [
    {
      id: "automations",
      label: copy.developerWorkbench.automationsSection,
      description: copy.developerWorkbench.automationsSectionDescription,
      icon: CalendarClock,
    },
    {
      id: "lab",
      label: copy.developerWorkbench.labSection,
      description: copy.developerWorkbench.labSectionDescription,
      icon: FlaskConical,
    },
    {
      id: "publishing",
      label: copy.developerWorkbench.publishingSection,
      description: copy.developerWorkbench.publishingSectionDescription,
      icon: PackageCheck,
    },
    {
      id: "design",
      label: copy.developerWorkbench.designSection,
      description: copy.developerWorkbench.designSectionDescription,
      icon: Palette,
    },
  ];

export function moveDeveloperWorkbenchSection(
  event: KeyboardEvent<HTMLButtonElement>,
  current: DeveloperWorkbenchSection,
  onSection: (section: DeveloperWorkbenchSection) => void,
): void {
  const index = DEVELOPER_WORKBENCH_SECTIONS.findIndex(
    (entry) => entry.id === current,
  );
  const next = nextSectionIndex(event.key, index);
  if (next === undefined) return;
  event.preventDefault();
  const section = DEVELOPER_WORKBENCH_SECTIONS[next]!;
  onSection(section.id);
  requestAnimationFrame(() =>
    document.getElementById(`developer-section-${section.id}`)?.focus(),
  );
}

function nextSectionIndex(key: string, currentIndex: number): number | undefined {
  if (key === "ArrowDown" || key === "ArrowRight") {
    return (currentIndex + 1) % DEVELOPER_WORKBENCH_SECTIONS.length;
  }
  if (key === "ArrowUp" || key === "ArrowLeft") {
    return (
      (currentIndex - 1 + DEVELOPER_WORKBENCH_SECTIONS.length) %
      DEVELOPER_WORKBENCH_SECTIONS.length
    );
  }
  if (key === "Home") return 0;
  if (key === "End") return DEVELOPER_WORKBENCH_SECTIONS.length - 1;
  return undefined;
}
