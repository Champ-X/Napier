import { describe, expect, it } from "vitest";

import {
  INSPECTOR_GROUPS,
  inspectorGroup,
  inspectorTabs,
  adjacentIndex,
} from "../src/InspectorNavigation";

describe("Inspector navigation", () => {
  it("uses Task, Inspect, and Studio progressive-disclosure groups", () => {
    expect(
      INSPECTOR_GROUPS.map(({ id, label, defaultTab, tabs }) => ({
        id,
        label,
        defaultTab,
        tabs,
      })),
    ).toEqual([
      {
        id: "task",
        label: "Task",
        defaultTab: "plan",
        tabs: ["plan", "goal", "files"],
      },
      {
        id: "inspect",
        label: "Inspect",
        defaultTab: "browser",
        tabs: ["browser", "trace", "processes"],
      },
      {
        id: "studio",
        label: "Studio",
        defaultTab: "studio",
        tabs: [
          "studio",
          "lab",
          "context",
          "memory",
          "extensions",
          "automations",
        ],
      },
    ]);
  });

  it("keeps the current tool first within its group", () => {
    expect(inspectorGroup("trace").id).toBe("inspect");
    expect(inspectorTabs("trace")).toEqual(["trace", "browser", "processes"]);
    expect(inspectorTabs("goal")).toEqual(["goal", "plan", "files"]);
    expect(inspectorTabs("files")).toEqual(["files", "plan", "goal"]);
    expect(inspectorTabs("studio")).toEqual([
      "studio",
      "lab",
      "context",
      "memory",
      "extensions",
      "automations",
    ]);
  });

  it("wraps arrow navigation and supports Home and End", () => {
    expect(adjacentIndex(0, 3, "ArrowLeft")).toBe(2);
    expect(adjacentIndex(2, 3, "ArrowRight")).toBe(0);
    expect(adjacentIndex(1, 3, "ArrowDown")).toBe(2);
    expect(adjacentIndex(1, 3, "ArrowUp")).toBe(0);
    expect(adjacentIndex(2, 3, "Home")).toBe(0);
    expect(adjacentIndex(0, 3, "End")).toBe(2);
    expect(adjacentIndex(0, 3, "Enter")).toBeUndefined();
  });
});
