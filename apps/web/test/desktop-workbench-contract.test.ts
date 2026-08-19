import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { taskSectionIds } from "../src/TaskWorkspace";
import { workspaceViews } from "../src/WorkspaceViewNavigation";

describe("Desktop workbench information architecture", () => {
  it("uses Conversation, Task, Trajectory order", () => {
    expect(workspaceViews.map((view) => view.id)).toEqual([
      "conversation",
      "task",
      "trajectory",
    ]);
  });

  it("keeps at most four task regions and discloses runtime on demand", () => {
    expect(taskSectionIds(false)).toEqual([
      "overview",
      "changes",
      "validation",
    ]);
    expect(taskSectionIds(true)).toEqual([
      "overview",
      "changes",
      "environment",
      "validation",
    ]);
  });

  it("keeps Product Trial out of the default task status path", async () => {
    const [narrative, developer] = await Promise.all([
      readFile(new URL("../src/TaskNarrativeBar.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/DeveloperToolsPanel.tsx", import.meta.url), "utf8"),
    ]);
    expect(narrative).not.toContain("DefaultProductTrialRecorder");
    expect(narrative).toContain("task-status-details");
    expect(developer).toContain("DefaultProductTrialRecorder");
  });
});
