import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Browser Live diagnosis handoff", () => {
  it("renders an explicit isolated-profile takeover route without solving CAPTCHAs", async () => {
    const source = (
      await Promise.all(
        [
          "BrowserLiveViewPanel.tsx",
          "BrowserLiveViewSurface.tsx",
          "use-browser-live-view-controller.ts",
          "use-browser-session-control.ts",
          "browser-live-copy.ts",
        ].map((file) =>
          readFile(new URL(`../src/${file}`, import.meta.url), "utf8"),
        ),
      )
    ).join("\n");

    expect(source).toContain("Human verification required");
    expect(source).toContain("Login required");
    expect(source).toContain("Take control");
    expect(source).toContain("isolated Browser profile");
    expect(source).toContain("not solve CAPTCHAs");
    expect(source).toContain("not solve CAPTCHAs or import existing Chrome");
    expect(source).toContain("browserLiveActivity");
    expect(source).toContain("browser-live-activity");
    expect(source).toContain('import("./browser-live-view-stream-api")');
    expect(source).not.toContain("setInterval(() => void refresh()");
    expect(source).toContain("onActivityChange");
    expect(source).not.toContain("document.cookie");
    expect(source).not.toContain("chrome.cookies");
  });
});
