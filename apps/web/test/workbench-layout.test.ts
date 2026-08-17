import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Workbench layout", () => {
  it("pins conversation sections inside the active workspace view", async () => {
    const styles = await readFile(
      new URL("../src/workspace-shell.css", import.meta.url),
      "utf8",
    );

    expect(styles).toContain('grid-template-areas:\n    "header"\n    "views"');
    expect(styles).toContain(
      '"narrative"\n    "notices"\n    "conversation"\n    "decisions"',
    );
    expect(styles).toContain(
      "grid-template-rows: auto auto minmax(0, 1fr) auto auto;",
    );
    expect(styles).toContain(".workspace-primary-surface");
    expect(styles).toContain(".conversation-workspace-view");
    expect(styles).toContain(".trace-workspace-view");
    expect(styles).toContain(".session-workspace-view");
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

  it("opens produced outputs through the Session Plan surface", async () => {
    const [app, navigation, summary, session, shell] = await Promise.all([
      readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
      readFile(
        new URL("../src/use-task-control-navigation.ts", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../src/TaskCompletionSummary.tsx", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../src/SessionWorkspace.tsx", import.meta.url), "utf8"),
      readFile(
        new URL("../src/use-workspace-shell.ts", import.meta.url),
        "utf8",
      ),
    ]);

    expect(summary).toContain("onClick={() => onOpenArtifact(path)}");
    expect(navigation).toContain('candidate.dataset["artifactPath"] === path');
    expect(navigation).toContain('openInspector("plan")');
    expect(app).toContain("onOpenArtifact={taskControls.openArtifact}");
    expect(shell).toContain('plan: "plan"');
    expect(shell).toContain('setWorkspaceView("session")');
    expect(session).toContain("<PlanInspectorSurface");
  });
});
