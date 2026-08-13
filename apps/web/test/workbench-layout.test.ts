import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Workbench layout", () => {
  it("pins optional sections to named rows so the composer cannot replace conversation", async () => {
    const styles = await readFile(
      new URL("../src/styles.css", import.meta.url),
      "utf8",
    );

    expect(styles).toContain('grid-template-areas:\n    "header"');
    expect(styles).toContain(
      '"narrative"\n    "notices"\n    "conversation"\n    "decisions"',
    );
    expect(styles).toContain(
      "grid-template-rows: 76px auto auto minmax(0, 1fr) auto auto;",
    );
    expect(styles).toContain(".task-narrative {\n  grid-area: narrative;");
    expect(styles).toContain(".workbench-notices {\n  grid-area: notices;");
    expect(styles).toContain(".conversation {\n  grid-area: conversation;");
    expect(styles).toContain(
      ".run-decision-dockets {\n  grid-area: decisions;",
    );
    expect(styles).toContain("grid-area: composer;");
  });

  it("keeps blockers and next actions independently visible", async () => {
    const source = await readFile(
      new URL("../src/TaskNarrativeBar.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("{narrative.blocker ? (");
    expect(source).toContain("{narrative.nextStep ? (");
    expect(source).not.toContain(") : narrative.nextStep ? (");
    expect(source).toContain('aria-label="Task controls"');
    expect(source).toContain("Browser controls");
    expect(source).toContain("onClick={onStop}");
  });

  it("opens produced outputs through the responsive Files inspector", async () => {
    const [app, navigation, summary, inspector] = await Promise.all([
      readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
      readFile(
        new URL("../src/use-task-control-navigation.ts", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../src/TaskCompletionSummary.tsx", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../src/ResponsiveInspector.tsx", import.meta.url),
        "utf8",
      ),
    ]);

    expect(summary).toContain("onClick={() => onOpenArtifact(path)}");
    expect(navigation).toContain('candidate.dataset["artifactPath"] === path');
    expect(navigation).toContain('openInspector("plan")');
    expect(app).toContain("onOpenArtifact={taskControls.openArtifact}");
    expect(app).toContain("openRequest={taskControls.inspectorOpenRequest}");
    expect(inspector).toContain("if (openRequest > 0) setOpen(true)");
  });
});
