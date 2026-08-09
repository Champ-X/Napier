import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Browser Inspector", () => {
  it("links to the single Browser Live task surface without duplicating controls", async () => {
    const source = await readFile(
      new URL("../src/BrowserInspectorPanel.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("Browser Live is active");
    expect(source).toContain("Open in task");
    expect(source).toContain(
      'querySelector<HTMLElement>(".browser-live-view")',
    );
    expect(source).not.toContain("pauseBrowserSession");
    expect(source).not.toContain("resumeBrowserSession");
    expect(source).not.toContain("BrowserTakeoverDesk");
  });
});
