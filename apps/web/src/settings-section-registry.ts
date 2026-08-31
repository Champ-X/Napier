import type { KeyboardEvent } from "react";
import { Bot, Brain, Cable, Languages } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { copy } from "./copy";

export type SettingsSection = "context" | "memory" | "extensions" | "language";

export interface SettingsSectionDefinition {
  id: SettingsSection;
  label: string;
  description: string;
  icon: LucideIcon;
}

export const SETTINGS_SECTIONS: ReadonlyArray<SettingsSectionDefinition> = [
  {
    id: "context",
    label: copy.settingsSurface.contextSection,
    description: copy.settingsSurface.contextSectionDescription,
    icon: Bot,
  },
  {
    id: "memory",
    label: copy.settingsSurface.memorySection,
    description: copy.settingsSurface.memorySectionDescription,
    icon: Brain,
  },
  {
    id: "extensions",
    label: copy.settingsSurface.extensionsSection,
    description: copy.settingsSurface.extensionsSectionDescription,
    icon: Cable,
  },
  {
    id: "language",
    label: copy.language.section,
    description: copy.language.sectionDescription,
    icon: Languages,
  },
];

export function moveSettingsSection(
  event: KeyboardEvent<HTMLButtonElement>,
  current: SettingsSection,
  onSection: (section: SettingsSection) => void,
): void {
  const index = SETTINGS_SECTIONS.findIndex((entry) => entry.id === current);
  const next = nextSettingsSectionIndex(event.key, index);
  if (next === undefined) return;
  event.preventDefault();
  const section = SETTINGS_SECTIONS[next]!;
  onSection(section.id);
  requestAnimationFrame(() =>
    document.getElementById(`settings-section-${section.id}`)?.focus(),
  );
}

function nextSettingsSectionIndex(
  key: string,
  currentIndex: number,
): number | undefined {
  if (key === "ArrowDown" || key === "ArrowRight") {
    return (currentIndex + 1) % SETTINGS_SECTIONS.length;
  }
  if (key === "ArrowUp" || key === "ArrowLeft") {
    return (
      (currentIndex - 1 + SETTINGS_SECTIONS.length) % SETTINGS_SECTIONS.length
    );
  }
  if (key === "Home") return 0;
  if (key === "End") return SETTINGS_SECTIONS.length - 1;
  return undefined;
}
