import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Goal progress honesty", () => {
  it("shows only real counters and never invents a percentage", async () => {
    const [app, styles] = await Promise.all([
      readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
    ]);

    expect(app).toContain("goal.continuationCount");
    expect(app).toContain("goal.noProgressCount");
    expect(app).not.toContain("goalProgress");
    expect(app).not.toContain('width: `${');
    expect(styles).not.toContain(".goal-progress");
  });
});
