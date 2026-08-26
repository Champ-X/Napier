import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { DEVELOPER_WORKBENCH_SECTIONS } from "../src/developer-workbench-section-registry";
import { SETTINGS_SECTIONS } from "../src/settings-section-registry";

describe("Settings and Developer Workbench boundary", () => {
  it("keeps ordinary settings limited to durable user configuration", () => {
    expect(SETTINGS_SECTIONS.map((section) => section.id)).toEqual([
      "context",
      "memory",
      "extensions",
      "workspace",
      "language",
    ]);
    expect(DEVELOPER_WORKBENCH_SECTIONS.map((section) => section.id)).toEqual([
      "automations",
      "lab",
      "publishing",
      "design",
    ]);
  });

  it("moves package signing and release governance out of Settings", async () => {
    const [
      settings,
      extensions,
      contextPackages,
      developer,
      publishing,
      prompt,
    ] = await Promise.all([
      readFile(
        new URL("../src/WorkspaceSettingsSurface.tsx", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../src/ExtensionPanel.tsx", import.meta.url), "utf8"),
      readFile(
        new URL("../src/ContextPackageManagement.tsx", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../src/DeveloperWorkbenchSurface.tsx", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../src/ExtensionPublishingSurface.tsx", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../src/PromptPackageDesk.tsx", import.meta.url),
        "utf8",
      ),
    ]);

    expect(settings).not.toContain("DeveloperToolsPanel");
    expect(settings).not.toContain("DesignSystemShowcase");
    expect(settings).not.toContain("WorkspaceAutomationSettings");
    expect(extensions).not.toContain("ExtensionPackageDesk");
    expect(contextPackages).not.toContain("SkillPackageDesk");
    expect(contextPackages).not.toContain("PromptPackageDesk");
    expect(developer).toContain("DeveloperToolsPanel");
    expect(developer).toContain("DesignSystemShowcase");
    expect(developer).toContain("WorkspaceAutomationSettings");
    expect(developer).toContain("AgentPackagePublishingSurface");
    expect(publishing).toContain("ExtensionPackageDesk");
    expect(prompt).toContain("prompt-package-desk");
  });
});
