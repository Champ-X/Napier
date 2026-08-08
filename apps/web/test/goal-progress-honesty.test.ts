import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Goal progress honesty", () => {
  it("shows only real counters and never invents a percentage", async () => {
    const [goalPanel, styles] = await Promise.all([
      readFile(new URL("../src/GoalPanel.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
    ]);

    expect(goalPanel).toContain("goal.continuationCount");
    expect(goalPanel).toContain("goal.noProgressCount");
    expect(goalPanel).not.toContain("goalProgress");
    expect(goalPanel).not.toContain('width: `${');
    expect(styles).not.toContain(".goal-progress");
  });
});
