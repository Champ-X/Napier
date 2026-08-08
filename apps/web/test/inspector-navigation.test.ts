import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Inspector navigation", () => {
  it("uses three progressive-disclosure groups without dropping tools", async () => {
    const source = await readFile(
      new URL("../src/InspectorNavigation.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('id: "activity"');
    expect(source).toContain('label: "Activity"');
    expect(source).toContain('tabs: ["trace", "processes", "plan", "goal"]');
    expect(source).toContain('id: "files"');
    expect(source).toContain('tabs: ["files", "lab"]');
    expect(source).toContain('id: "inspect"');
    expect(source).toContain(
      'tabs: ["context", "memory", "extensions", "automations"]',
    );
    expect(source).toContain('aria-label="Inspector sections"');
    expect(source).toContain("group.defaultTab");
    expect(source).toContain("copy.tabs[tab]");
  });
});
