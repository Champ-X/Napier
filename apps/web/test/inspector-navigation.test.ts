import { describe, expect, it } from "vitest";

import {
  INSPECTOR_GROUPS,
  inspectorGroup,
  inspectorTabs,
  adjacentIndex,
} from "../src/InspectorNavigation";

describe("Inspector navigation", () => {
  it("uses three progressive-disclosure groups without dropping tools", () => {
    expect(
      INSPECTOR_GROUPS.map(({ id, label, defaultTab, tabs }) => ({
        id,
        label,
        defaultTab,
        tabs,
      })),
    ).toEqual([
      {
        id: "activity",
        label: "Activity/Plan",
        defaultTab: "plan",
        tabs: ["plan", "goal"],
      },
      {
        id: "files",
        label: "Files/Artifacts",
        defaultTab: "files",
        tabs: ["files"],
      },
      {
        id: "inspect",
        label: "Inspect",
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
    ]);
  });

  it("keeps the current tool first within its group", () => {
    expect(inspectorGroup("trace").id).toBe("inspect");
    expect(inspectorTabs("trace")).toEqual([
      "trace",
      "context",
      "browser",
      "processes",
      "lab",
      "memory",
      "extensions",
      "automations",
    ]);
    expect(inspectorTabs("goal")).toEqual(["goal", "plan"]);
    expect(inspectorTabs("files")).toEqual(["files"]);
    expect(inspectorTabs("browser")).toEqual([
      "browser",
      "context",
      "trace",
      "processes",
      "lab",
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
