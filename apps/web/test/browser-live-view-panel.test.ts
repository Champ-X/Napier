import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Browser Live diagnosis handoff", () => {
  it("renders an explicit isolated-profile takeover route without solving CAPTCHAs", async () => {
    const source = await readFile(
      new URL("../src/BrowserLiveViewPanel.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("Human verification required");
    expect(source).toContain("Login required");
    expect(source).toContain("Take control");
    expect(source).toContain("isolated Browser profile");
    expect(source).toContain("not solve CAPTCHAs");
    expect(source).toContain("not solve CAPTCHAs or import existing Chrome");
    expect(source).not.toContain("document.cookie");
    expect(source).not.toContain("chrome.cookies");
  });
});
