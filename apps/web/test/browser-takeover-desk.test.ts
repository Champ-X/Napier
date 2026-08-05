import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Browser takeover desk", () => {
  it("keeps bounded actions and private text handling explicit", async () => {
    const source = await readFile(
      new URL("../src/BrowserTakeoverDesk.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("Take control of this isolated Browser Session");
    expect(source).toContain('type="password"');
    expect(source).toContain('autoComplete="off"');
    expect(source).toContain('setValue("")');
    expect(source).toContain("Scroll down");
    expect(source).toContain("New tab");
    expect(source).toContain("Forward");
    expect(source).toContain(
      "...(allowCrossOrigin ? { allowCrossOrigin: true } : {})",
    );
    expect(source).toContain('setNewTabUrl("")');
    expect(source).toContain("Return to Agent");
    expect(source).not.toContain("PRIVATE_OPERATOR_SECRET");
  });
});
