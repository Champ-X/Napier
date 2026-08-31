import { parseHTML } from "linkedom";
import { renderToStringAsync } from "preact-render-to-string";
import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("lucide-react", () => {
  const Icon = (props: Record<string, unknown>) => <svg {...props} />;
  return {
    CalendarClock: Icon,
    FlaskConical: Icon,
    Gauge: Icon,
    GitFork: Icon,
    PackageCheck: Icon,
    Palette: Icon,
    Workflow: Icon,
    X: Icon,
  };
});
vi.mock("../src/RunLabPanel", () => ({
  default: () => <div data-testid="lab-panel" />,
}));
vi.mock("../src/ContextCompactionWorkbenchPanel", () => ({
  ContextCompactionWorkbenchPanel: () => (
    <input aria-label="Compaction draft" defaultValue="" />
  ),
}));
vi.mock("../src/PlanInspectorSurface", () => ({
  PlanInspectorSurface: () => <div data-testid="workflow-panel" />,
}));
vi.mock("../src/DefaultProductTrialRecorder", () => ({
  DefaultProductTrialRecorder: () => <div data-testid="trial-panel" />,
}));
vi.mock("../src/WorkspaceAutomationSettings", () => ({
  WorkspaceAutomationSettings: () => <div data-testid="automations-panel" />,
}));
vi.mock("../src/AgentPackagePublishingSurface", () => ({
  AgentPackagePublishingSurface: () => <div data-testid="agent-publishing" />,
}));
vi.mock("../src/DesignSystemShowcase", () => ({
  DesignSystemShowcase: () => <div data-testid="design-showcase" />,
}));
vi.mock("../src/ExtensionPublishingSurface", () => ({
  ExtensionPublishingSurface: () => <div data-testid="publishing-panel" />,
}));

import { DeveloperToolsPanel } from "../src/DeveloperToolsPanel";
import { DeveloperWorkbenchSurface } from "../src/DeveloperWorkbenchSurface";

const roots: Root[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("DeveloperToolsPanel", () => {
  it("exposes only the selected tab in the sequential focus order", async () => {
    const markup = await renderToStringAsync(
      <DeveloperToolsPanel
        vm={viewModel(true)}
        activeModel={activeModel()}
        onConversation={() => undefined}
      />,
    );

    expect(markup).toMatch(/id="developer-tool-tab-lab"[^>]*tabindex="0"/u);
    expect(markup).toMatch(
      /id="developer-tool-tab-compaction"[^>]*tabindex="-1"/u,
    );
    expect(markup).toMatch(
      /id="developer-tool-tab-workflow"[^>]*tabindex="-1"/u,
    );
    expect(markup).toMatch(/id="developer-tool-tab-trial"[^>]*tabindex="-1"/u);
  });

  it("keeps visited panels mounted and links every tab to its panel", async () => {
    const container = installDom();
    await renderPanel(container, true);

    const labTab = tab(container, "lab");
    const compactionTab = tab(container, "compaction");
    const workflowTab = tab(container, "workflow");
    const labPanel = panel(container, "lab");
    const compactionPanel = panel(container, "compaction");

    expect(labTab.getAttribute("aria-selected")).toBe("true");
    expect(labPanel.hasAttribute("hidden")).toBe(false);
    expect(compactionPanel.hasAttribute("hidden")).toBe(true);

    for (const tool of ["lab", "compaction", "workflow", "trial"]) {
      const toolTab = tab(container, tool);
      const toolPanel = panel(container, tool);
      expect(toolTab.getAttribute("aria-controls")).toBe(toolPanel.id);
      expect(toolPanel.getAttribute("aria-labelledby")).toBe(toolTab.id);
    }

    await click(compactionTab);
    const draft = container.querySelector<HTMLInputElement>(
      'input[aria-label="Compaction draft"]',
    )!;
    draft.value = "keep this preview state";

    await click(workflowTab);
    expect(compactionPanel.hasAttribute("hidden")).toBe(true);
    expect(draft.isConnected).toBe(true);

    await click(compactionTab);
    expect(compactionPanel.hasAttribute("hidden")).toBe(false);
    expect(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="Compaction draft"]',
      ),
    ).toBe(draft);
    expect(draft.value).toBe("keep this preview state");
  });

  it("uses roving focus and supports Arrow, Home, and End navigation", async () => {
    const container = installDom();
    await renderPanel(container, true);

    const lab = tab(container, "lab");
    const compaction = tab(container, "compaction");
    const trial = tab(container, "trial");
    lab.focus();
    const labFocus = vi.spyOn(lab, "focus");
    const compactionFocus = vi.spyOn(compaction, "focus");
    const trialFocus = vi.spyOn(trial, "focus");

    await key(lab, "ArrowRight");
    expect(compaction.getAttribute("aria-selected")).toBe("true");
    expect(compactionFocus).toHaveBeenCalledTimes(1);

    await key(compaction, "End");
    expect(trial.getAttribute("aria-selected")).toBe("true");
    expect(trialFocus).toHaveBeenCalledTimes(1);

    await key(trial, "Home");
    expect(lab.getAttribute("aria-selected")).toBe("true");
    expect(labFocus).toHaveBeenCalledTimes(1);

    await key(lab, "ArrowLeft");
    expect(trial.getAttribute("aria-selected")).toBe("true");
    expect(trialFocus).toHaveBeenCalledTimes(2);
  });

  it("skips disabled tools during keyboard navigation", async () => {
    const container = installDom();
    await renderPanel(container, false);

    const lab = tab(container, "lab");
    const workflow = tab(container, "workflow");
    const trial = tab(container, "trial");
    expect(trial.hasAttribute("disabled")).toBe(true);

    lab.focus();
    const workflowFocus = vi.spyOn(workflow, "focus");
    await key(lab, "End");
    expect(workflow.getAttribute("aria-selected")).toBe("true");
    expect(workflowFocus).toHaveBeenCalledTimes(1);
  });
});

describe("DeveloperWorkbenchSurface", () => {
  it("preserves the selected inner tool and its mounted state across top-level sections", async () => {
    const container = installDom();
    const root = createRoot(container);
    roots.push(root);

    function Harness() {
      const [section, setSection] =
        useState<Parameters<typeof DeveloperWorkbenchSurface>[0]["section"]>(
          "lab",
        );
      return (
        <DeveloperWorkbenchSurface
          vm={viewModel(true)}
          activeAgent={undefined}
          section={section}
          onSection={setSection}
          onClose={() => undefined}
          onConversation={() => undefined}
        />
      );
    }

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });

    await click(tab(container, "compaction"));
    const draft = container.querySelector<HTMLInputElement>(
      'input[aria-label="Compaction draft"]',
    )!;
    draft.value = "keep this state between workbench sections";
    const developerTools =
      container.querySelector<HTMLElement>(".developer-tools")!;

    await click(
      container.querySelector<HTMLButtonElement>(
        "#developer-section-automations",
      )!,
    );
    expect(developerTools.hasAttribute("hidden")).toBe(true);
    expect(developerTools.style.display).toBe("none");
    expect(draft.isConnected).toBe(true);

    await click(
      container.querySelector<HTMLButtonElement>("#developer-section-lab")!,
    );
    expect(developerTools.hasAttribute("hidden")).toBe(false);
    expect(developerTools.style.display).toBe("");
    expect(tab(container, "compaction").getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="Compaction draft"]',
      ),
    ).toBe(draft);
    expect(draft.value).toBe("keep this state between workbench sections");
  });
});

async function renderPanel(container: HTMLElement, withDetail: boolean) {
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(
      <DeveloperToolsPanel
        vm={viewModel(withDetail)}
        activeModel={activeModel()}
        onConversation={() => undefined}
      />,
    );
    await Promise.resolve();
  });
}

function viewModel(
  withDetail: boolean,
): Parameters<typeof DeveloperToolsPanel>[0]["vm"] {
  const noOp = () => undefined;
  const asyncNoOp = async () => undefined;
  return {
    terminalRuns: [],
    messages: [],
    detail: withDetail
      ? {
          thread: { id: "thread_1", title: "Thread" },
          events: [],
          plans: [],
          runs: [],
          evaluations: [],
        }
      : undefined,
    bootstrap: { models: [] },
    runComparison: undefined,
    labLeftRunId: "",
    labRightRunId: "",
    selectedModelKey: "napier/demo",
    isRunning: false,
    labBusyAction: undefined,
    labFixtureReceipt: undefined,
    runReplayVerificationReceipt: undefined,
    selectedModel: activeModel(),
    selectLabLeftRun: noOp,
    selectLabRightRun: noOp,
    compareSelectedRuns: asyncNoOp,
    evaluateSelectedRuns: asyncNoOp,
    exportRunReplay: asyncNoOp,
    verifyRunReplaySnapshotFile: asyncNoOp,
    exportThreadFixture: asyncNoOp,
    verifyThreadFixture: asyncNoOp,
    importThreadFixture: asyncNoOp,
    selectThread: asyncNoOp,
    refreshActiveThread: asyncNoOp,
    setComposer: noOp,
    submit: asyncNoOp,
  } as unknown as Parameters<typeof DeveloperToolsPanel>[0]["vm"];
}

function activeModel(): Parameters<
  typeof DeveloperToolsPanel
>[0]["activeModel"] {
  return {
    key: "napier/demo",
    provider: "napier",
    id: "demo",
    label: "Napier Demo",
    configured: true,
    known: true,
  };
}

function tab(container: HTMLElement, tool: string): HTMLButtonElement {
  return container.querySelector<HTMLButtonElement>(
    `#developer-tool-tab-${tool}`,
  )!;
}

function panel(container: HTMLElement, tool: string): HTMLElement {
  return container.querySelector<HTMLElement>(`#developer-tool-panel-${tool}`)!;
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => button.click());
}

async function key(button: HTMLButtonElement, value: string): Promise<void> {
  await act(async () => {
    const event = new Event("keydown", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "key", { value });
    button.dispatchEvent(event);
  });
}

function installDom(): HTMLElement {
  const { document, window } = parseHTML(
    "<!doctype html><html><body><div id=app></div></body></html>",
  );
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("navigator", window.navigator);
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  vi.stubGlobal("Event", window.Event);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  return document.getElementById("app") as unknown as HTMLElement;
}
