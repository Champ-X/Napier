import { parseHTML } from "linkedom";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EvaluationCasebook, RunRecord } from "@napier/contracts";
import type { EvaluationCasebookTemplate } from "@napier/contracts/evaluation-casebook-template";

import {
  DEFAULT_PRODUCT_CASE_IDS,
  DefaultProductTrialRecorder,
  latestTerminalRun,
} from "../src/DefaultProductTrialRecorder";

vi.mock("../src/ReleaseProductTrialControl", () => ({
  ReleaseProductTrialControl: ({
    selectedCaseId,
    runs,
  }: {
    selectedCaseId: string;
    runs: RunRecord[];
  }) => (
    <div
      data-release-product-recorder={selectedCaseId}
      data-run-id={runs[0]?.id}
    />
  ),
}));

const roots: ReturnType<typeof createRoot>[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("Default product trial recorder", () => {
  it("selects the latest terminal Run and the six M4 core cases", async () => {
    const container = installDom();
    const root = createRoot(container);
    roots.push(root);
    await act(async () =>
      root.render(
        <DefaultProductTrialRecorder
          threadId="thread_product01"
          runs={[run("run_old", "completed", 1), run("run_new", "failed", 2)]}
          listCasebooks={async () => [casebook]}
          listTemplates={async () => [
            { ...template, cases: template.cases.slice().reverse() },
          ]}
        />,
      ),
    );
    toggle(container);
    await vi.waitFor(() =>
      expect(
        container.querySelector("[data-release-product-recorder]"),
      ).not.toBeNull(),
    );

    expect(DEFAULT_PRODUCT_CASE_IDS).toEqual([
      "network-reference",
      "coding-verification",
      "dynamic-browser",
      "high-risk-confirmation",
      "artifact-delivery",
      "long-task-recovery",
    ]);
    const coreCaseSelect = container.querySelector(
      '[aria-label="Default product core case"]',
    ) as HTMLSelectElement;
    expect(
      [...coreCaseSelect.children].map((item) => item.getAttribute("value")),
    ).toEqual(DEFAULT_PRODUCT_CASE_IDS);
    expect(
      container
        .querySelector("[data-release-product-recorder]")
        ?.getAttribute("data-run-id"),
    ).toBe("run_new");
  });

  it("prepares the fixed Casebook on demand and renders nothing before a terminal Run", async () => {
    const empty = installDom();
    const emptyRoot = createRoot(empty);
    roots.push(emptyRoot);
    await act(async () =>
      emptyRoot.render(
        <DefaultProductTrialRecorder
          threadId="thread_product02"
          runs={[run("run_active", "running", 1)]}
        />,
      ),
    );
    expect(empty.textContent).toBe("");

    const container = installDom();
    const root = createRoot(container);
    roots.push(root);
    const createCasebook = vi.fn(async () => casebook);
    await act(async () =>
      root.render(
        <DefaultProductTrialRecorder
          threadId="thread_product03"
          runs={[run("run_done", "completed", 1)]}
          listCasebooks={async () => []}
          listTemplates={async () => [template]}
          createCasebook={createCasebook}
        />,
      ),
    );
    toggle(container);
    const prepare = await vi.waitFor(() => {
      const button = container.querySelector(
        '[aria-label="Prepare default product trial record"]',
      );
      expect(button).not.toBeNull();
      return button!;
    });
    await act(async () =>
      prepare.dispatchEvent(new Event("click", { bubbles: true })),
    );
    await vi.waitFor(() => expect(createCasebook).toHaveBeenCalledOnce());
    expect(createCasebook).toHaveBeenCalledWith({
      threadId: "thread_product03",
      name: template.name,
      description: template.description,
      templateId: template.id,
    });
    await vi.waitFor(() =>
      expect(
        container.querySelector("[data-release-product-recorder]"),
      ).not.toBeNull(),
    );
  });

  it("uses the latest started terminal Run", () => {
    expect(
      latestTerminalRun([
        run("run_one", "completed", 1),
        run("run_two", "cancelled", 3),
        run("run_three", "running", 4),
      ])?.id,
    ).toBe("run_two");
  });
});

const template: EvaluationCasebookTemplate = {
  id: "release-product-v1",
  version: 1,
  name: "Release Product Casebook",
  description: "Fixed default product coverage.",
  cases: [
    ...DEFAULT_PRODUCT_CASE_IDS.map((id) => ({
      id,
      title: id,
      description: id,
      taskPrompt: id,
      acceptanceCriteria: [id],
      critical: true,
    })),
    {
      id: "settings",
      title: "Settings",
      description: "Settings",
      taskPrompt: "Settings",
      acceptanceCriteria: ["Settings"],
      critical: true,
    },
  ],
};

const casebook = {
  id: "casebook_product01",
  templateId: template.id,
} as EvaluationCasebook;

function run(
  id: string,
  status: RunRecord["status"],
  second: number,
): RunRecord {
  return {
    id,
    threadId: "thread_product01",
    agentId: "agent_napier",
    status,
    source: "user",
    startedAt: `2026-08-16T00:00:0${String(second)}.000Z`,
    ...(status === "running"
      ? {}
      : { finishedAt: `2026-08-16T00:00:1${String(second)}.000Z` }),
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    },
  };
}

function toggle(container: HTMLElement): void {
  const details = container.firstElementChild as HTMLDetailsElement;
  details.open = true;
  details.dispatchEvent(new Event("toggle", { bubbles: true }));
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
