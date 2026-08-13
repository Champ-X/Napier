import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { browserTaskDefaultModel } from "../src/BrowserUseLocalTaskPanel";

describe("Browser Inspector", () => {
  it("links to the single Browser Live task surface without duplicating controls", async () => {
    const source = (
      await Promise.all(
        [
          "BrowserInspectorPanel.tsx",
          "BrowserUseLocalTaskPanel.tsx",
          "BrowserTaskForm.tsx",
          "use-browser-task-runner.ts",
        ].map((file) =>
          readFile(new URL(`../src/${file}`, import.meta.url), "utf8"),
        ),
      )
    ).join("\n");

    expect(source).toContain("Browser Live is active");
    expect(source).toContain("Open in task");
    expect(source).toContain("Browser Use local");
    expect(source).toContain("Browser Use Cloud");
    expect(source).toContain("Cloud data and billing boundary");
    expect(source).toContain("zero retention is not assumed");
    expect(source).toContain("Visible local browser and takeover");
    expect(source).toContain("Pause");
    expect(source).toContain("Take over");
    expect(source).toContain("CAPTCHA");
    expect(source).toContain("stopBrowserTask");
    expect(source).toContain(
      'querySelector<HTMLElement>(".browser-live-view")',
    );
    expect(source).not.toContain("pauseBrowserSession");
    expect(source).not.toContain("resumeBrowserSession");
    expect(source).not.toContain("BrowserTakeoverDesk");
  });

  it("prefills Browser Use local from the selected configured product model", () => {
    const models = [
      model("openai", "gpt-4.1", true),
      model("deepseek", "deepseek-chat", true),
    ];
    expect(
      browserTaskDefaultModel(
        {
          key: "deepseek/deepseek-chat",
          provider: "deepseek",
          id: "deepseek-chat",
          label: "DeepSeek",
          configured: true,
          known: true,
        },
        models,
        { provider: "openai", id: "gpt-fallback" },
      ),
    ).toEqual({ provider: "deepseek", id: "deepseek-chat" });
    expect(
      browserTaskDefaultModel(undefined, models, {
        provider: "openai",
        id: "gpt-fallback",
      }),
    ).toEqual({ provider: "openai", id: "gpt-4.1" });
  });
});

function model(provider: string, id: string, configured: boolean) {
  return {
    provider,
    providerName: provider,
    id,
    name: id,
    contextWindow: 128_000,
    reasoning: true,
    vision: false,
    configured,
  };
}
