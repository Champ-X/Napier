import { parseHTML } from "linkedom";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EvaluationCasebook, RunRecord } from "@napier/contracts";
import type { EvaluationCasebookTemplate } from "@napier/contracts/evaluation-casebook-template";
import type {
  ReleaseProductGateProjection,
  ReleaseProductTrial,
} from "@napier/contracts/release-product-trial";

import { ReleaseProductTrialControl } from "../src/ReleaseProductTrialControl";

const roots: ReturnType<typeof createRoot>[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("ReleaseProductTrialControl", () => {
  it("records a real terminal Run and exposes the version gate", async () => {
    const container = installDom();
    const loadGate = vi.fn(async () => emptyProjection);
    const submitTrial = vi.fn(async (_threadId, request) => ({
      trial: {
        id: "release_trial_00000001",
        ...request,
      } as unknown as ReleaseProductTrial,
      gate: {
        ...emptyProjection,
        versions: [
          {
            productVersion: "0.1.0",
            caseCount: 10,
            coveredCaseCount: 1,
            trialCount: 1,
            passedCount: 1,
            failedCount: 0,
            inconclusiveCount: 0,
            successRate: 1,
            minimumSuccessRate: 0.9,
            meanUxScore: 5,
            configurationInterventions: 0,
            humanInterventions: 0,
            recoveryEvents: 0,
            criticalCaseIds: ["settings"],
            failedCriticalCaseIds: [],
            status: "incomplete" as const,
            firstRecordedAt: "2026-08-13T00:00:00.000Z",
            lastRecordedAt: "2026-08-13T00:00:00.000Z",
          },
        ],
      },
    }));
    const root = createRoot(container);
    roots.push(root);
    await act(async () =>
      root.render(
        <ReleaseProductTrialControl
          threadId="thread_release01"
          casebook={casebook}
          template={template}
          selectedCaseId="settings"
          runs={[run]}
          loadGate={loadGate}
          submitTrial={submitTrial}
        />,
      ),
    );
    await act(async () => Promise.resolve());

    expect(loadGate).toHaveBeenCalledWith("thread_release01", casebook.id);
    expect(container.textContent).toContain("0/3 versions");
    const button = [...container.firstElementChild!.children].find((item) => item.tagName === "BUTTON") as HTMLButtonElement;
    expect(button.hasAttribute("disabled")).toBe(false);
    await act(async () =>
      button.dispatchEvent(new Event("click", { bubbles: true })),
    );
    await act(async () => Promise.resolve());

    expect(submitTrial).toHaveBeenCalledWith(
      "thread_release01",
      expect.objectContaining({
        casebookId: casebook.id,
        templateCaseId: "settings",
        runId: run.id,
        productVersion: "0.1.0",
        status: "passed",
        uxScore: 5,
      }),
    );
    expect(container.textContent).toContain(
      "1/10 Cases · 100% success · UX 5/5",
    );
    expect(container.textContent).toContain("remain independent");
  });
});

const template: EvaluationCasebookTemplate = {
  id: "release-product-v1",
  version: 1,
  name: "Release Product Casebook",
  description: "Fixed product coverage.",
  cases: [
    {
      id: "settings",
      title: "Settings",
      description: "Configure the product.",
      taskPrompt: "Configure Napier.",
      acceptanceCriteria: ["Setup works"],
      critical: true,
    },
  ],
};

const casebook = {
  id: "casebook_release0001",
  templateId: template.id,
} as EvaluationCasebook;

const run = {
  id: "run_release0001",
  threadId: "thread_release01",
  status: "completed",
  startedAt: "2026-08-13T00:00:00.000Z",
  finishedAt: "2026-08-13T00:01:00.000Z",
} as RunRecord;

const emptyProjection: ReleaseProductGateProjection = {
  kind: "napier.release-product-gate",
  schemaVersion: 1,
  currentProductVersion: "0.1.0",
  casebookId: casebook.id,
  templateId: template.id,
  templateVersion: 1,
  minimumSuccessRate: 0.9,
  requiredConsecutiveVersions: 3,
  versions: [],
  consecutivePassingVersions: [],
  defaultTrackReady: false,
  trials: [],
  contentSha256: "a".repeat(64),
};

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
  return document.getElementById("app") as HTMLElement;
}
