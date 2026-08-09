import { describe, expect, it } from "vitest";

import {
  INSPECTOR_GROUPS,
  inspectorGroup,
  inspectorTabs,
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
      "processes",
      "lab",
      "memory",
      "extensions",
      "automations",
    ]);
    expect(inspectorTabs("goal")).toEqual(["goal", "plan"]);
    expect(inspectorTabs("files")).toEqual(["files"]);
  });
});
