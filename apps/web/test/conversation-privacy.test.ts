import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Conversation privacy", () => {
  it("does not surface private model reasoning in the message pane", async () => {
    const [app, styles] = await Promise.all([
      readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
    ]);

    expect(app).not.toContain("reasoning-note");
    expect(app).not.toContain("message.reasoning");
    expect(app).not.toContain("Reasoning note");
    expect(styles).not.toContain(".reasoning-note");
  });

  it("keeps the message view free of a reasoning field", async () => {
    const viewModel = await readFile(
      new URL("../src/use-workspace-view-model.ts", import.meta.url),
      "utf8",
    );
    expect(viewModel).not.toContain("reasoning: payload.reasoning");
  });
});
