import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Browser takeover desk", () => {
  it("keeps bounded actions and private text handling explicit", async () => {
    const [source, output] = await Promise.all([
      Promise.all(
        [
          "BrowserTakeoverDesk.tsx",
          "BrowserTakeoverWorkspace.tsx",
          "BrowserTakeoverActionControls.tsx",
          "BrowserTakeoverQuickControls.tsx",
          "use-browser-takeover-desk.ts",
          "browser-live-copy.ts",
        ].map((file) =>
          readFile(new URL(`../src/${file}`, import.meta.url), "utf8"),
        ),
      ).then((parts) => parts.join("\n")),
      readFile(
        new URL("../src/BrowserTakeoverOutput.tsx", import.meta.url),
        "utf8",
      ),
    ]);

    expect(source).toContain("Take control of this isolated Browser Session");
    expect(source).toContain('type="password"');
    expect(source).toContain('autoComplete="off"');
    expect(source).toContain('value: ""');
    expect(source).toContain("Scroll down");
    expect(source).toContain("New tab");
    expect(source).toContain("Forward");
    expect(source).toContain("Click the verified Browser viewport");
    expect(source).toContain("Navigation key");
    expect(source).toContain("Press key");
    expect(source).toContain("expectedLiveImageSha256");
    expect(source).toContain(
      "...(form.allowCrossOrigin ? { allowCrossOrigin: true } : {})",
    );
    expect(source).toContain('newTabUrl: ""');
    expect(source).toContain("Return to Agent");
    const outputContract = `${output}\n${source}`;
    expect(outputContract).toContain("New workspace output");
    expect(outputContract).toContain("Save screenshot");
    expect(outputContract).toContain("Download ref");
    expect(output).toContain("expectedLiveImageSha256");
    expect(outputContract).toContain("Screenshot saved");
    expect(outputContract).toContain("download 32 MiB");
    expect(output).not.toContain("document.cookie");
    expect(output).not.toContain("chrome.cookies");
    expect(source).not.toContain("PRIVATE_OPERATOR_SECRET");
  });
});
