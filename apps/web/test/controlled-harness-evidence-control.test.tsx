import { parseHTML } from "linkedom";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EvaluationCasebook } from "@napier/contracts";
import type {
  ControlledHarnessEvidence,
  ControlledHarnessGateProjection,
} from "@napier/contracts/controlled-harness-evidence";
import type { EvaluationCasebookTemplate } from "@napier/contracts/evaluation-casebook-template";

import { ControlledHarnessEvidenceControl } from "../src/ControlledHarnessEvidenceControl";

const roots: ReturnType<typeof createRoot>[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("ControlledHarnessEvidenceControl", () => {
  it("imports verified evidence and renders explicit sample blockers", async () => {
    const container = installDom();
    const loadGate = vi.fn(async () => emptyGate);
    const submitEvidence = vi.fn(async () => ({ evidence, gate }));
    const root = createRoot(container);
    roots.push(root);
    await act(async () =>
      root.render(
        <ControlledHarnessEvidenceControl
          threadId="thread_release01"
          casebook={casebook}
          template={template}
          loadGate={loadGate}
          submitEvidence={submitEvidence}
        />,
      ),
    );
    await act(async () => Promise.resolve());

    expect(container.textContent).toContain("not proven");
    expect(container.textContent).toContain(
      "No controlled comparison evidence recorded.",
    );
    const input = findInput(container);
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [
        {
          size: 100,
          text: async () => JSON.stringify(evidence),
        },
      ],
    });
    await act(async () =>
      input.dispatchEvent(new Event("change", { bubbles: true })),
    );
    await act(async () => Promise.resolve());

    expect(submitEvidence).toHaveBeenCalledWith(
      "thread_release01",
      casebook.id,
      evidence,
    );
    expect(container.textContent).toContain("Coding vs OMP");
    expect(container.textContent).toContain("13/12 passed · 13/13 decisive");
    expect(container.textContent).toContain(
      "sample not proven:browser autonomy",
    );
    expect(container.textContent).toContain("Quantified advantage");
    expect(container.textContent).toContain(
      "Napier 1.000 vs OMP 0.667 verifiable final evidence rate · n=6/6",
    );
    expect(container.textContent).toContain("remain independent");
  });
});

const template = {
  id: "release-product-v1",
  version: 1,
  name: "Release Product Casebook",
  description: "Fixed product coverage.",
  cases: [],
} as EvaluationCasebookTemplate;

const casebook = {
  id: "casebook_release0001",
  templateId: template.id,
} as EvaluationCasebook;

const comparisonGates = [
  {
    domain: "search",
    baseline: "omp",
    caseCount: 2,
    trialCount: 2,
    decisiveTrialCount: 2,
    excludedTrialCount: 0,
    napierPassed: 1,
    baselinePassed: 1,
    napierOnlyPassed: 1,
    baselineOnlyPassed: 1,
    napierSecretLeakDetected: false,
    napierUnconfirmedSideEffectDetected: false,
    fairness: {
      sameModel: true,
      samePrompt: true,
      isolatedWorkspace: true,
      samePermissions: true,
    },
    sourceArtifactSha256s: ["1".repeat(64)],
    minimumCaseCount: 2,
    minimumTrialCount: 2,
    minimumDecisiveTrialCount: 2,
    minimumDecisiveCoverage: 2 / 3,
    sampleReady: true,
    verdict: "napier_not_worse",
    comparisonReady: true,
  },
  {
    domain: "coding",
    baseline: "omp",
    caseCount: 10,
    trialCount: 13,
    decisiveTrialCount: 13,
    excludedTrialCount: 0,
    napierPassed: 13,
    baselinePassed: 12,
    napierOnlyPassed: 1,
    baselineOnlyPassed: 0,
    napierSecretLeakDetected: false,
    napierUnconfirmedSideEffectDetected: false,
    fairness: {
      sameModel: true,
      samePrompt: true,
      isolatedWorkspace: true,
      samePermissions: true,
    },
    sourceArtifactSha256s: ["2".repeat(64)],
    minimumCaseCount: 3,
    minimumTrialCount: 3,
    minimumDecisiveTrialCount: 3,
    minimumDecisiveCoverage: 2 / 3,
    sampleReady: true,
    verdict: "napier_not_worse",
    comparisonReady: true,
  },
  {
    domain: "browser_omp",
    baseline: "omp",
    caseCount: 2,
    trialCount: 2,
    decisiveTrialCount: 1,
    excludedTrialCount: 1,
    napierPassed: 1,
    baselinePassed: 1,
    napierOnlyPassed: 0,
    baselineOnlyPassed: 0,
    napierSecretLeakDetected: false,
    napierUnconfirmedSideEffectDetected: false,
    fairness: {
      sameModel: true,
      samePrompt: true,
      isolatedWorkspace: true,
      samePermissions: true,
    },
    sourceArtifactSha256s: ["1".repeat(64)],
    minimumCaseCount: 2,
    minimumTrialCount: 2,
    minimumDecisiveTrialCount: 2,
    minimumDecisiveCoverage: 2 / 3,
    sampleReady: false,
    verdict: "not_proven",
    comparisonReady: false,
  },
  {
    domain: "browser_autonomy",
    baseline: "browser_use",
    caseCount: 1,
    trialCount: 1,
    decisiveTrialCount: 1,
    excludedTrialCount: 0,
    napierPassed: 1,
    baselinePassed: 0,
    napierOnlyPassed: 1,
    baselineOnlyPassed: 0,
    napierSecretLeakDetected: false,
    napierUnconfirmedSideEffectDetected: false,
    fairness: {
      sameModel: true,
      samePrompt: true,
      isolatedWorkspace: true,
      samePermissions: true,
    },
    sourceArtifactSha256s: ["3".repeat(64)],
    minimumCaseCount: 1,
    minimumTrialCount: 3,
    minimumDecisiveTrialCount: 3,
    minimumDecisiveCoverage: 2 / 3,
    sampleReady: false,
    verdict: "not_proven",
    comparisonReady: false,
  },
] as ControlledHarnessEvidence["comparisonGates"];

const evidence = {
  kind: "napier.controlled-harness-evidence",
  schemaVersion: 1,
  generatedAt: "2026-08-13T00:00:00.000Z",
  productVersion: "0.1.2",
  model: { provider: "deepseek", id: "deepseek-v4-flash" },
  sources: [],
  comparisons: comparisonGates,
  advantage: {
    metric: "evidence",
    baseline: "omp",
    direction: "higher",
    unit: "verifiable_final_evidence_rate",
    napierValue: 1,
    baselineValue: 0.666667,
    napierSampleCount: 6,
    baselineSampleCount: 6,
    sourceArtifactSha256s: ["1".repeat(64)],
  },
  comparisonGates,
  advantageGate: {
    metric: "evidence",
    baseline: "omp",
    direction: "higher",
    unit: "verifiable_final_evidence_rate",
    napierValue: 1,
    baselineValue: 0.666667,
    napierSampleCount: 6,
    baselineSampleCount: 6,
    sourceArtifactSha256s: ["1".repeat(64)],
    minimumSampleCount: 3,
    advantageReady: true,
  },
  controlledTrackReady: false,
  blockers: [
    "sample_not_proven:browser_omp",
    "sample_not_proven:browser_autonomy",
  ],
  contentSha256: "4".repeat(64),
} as ControlledHarnessEvidence;

const emptyGate: ControlledHarnessGateProjection = {
  kind: "napier.controlled-harness-gate",
  schemaVersion: 1,
  currentProductVersion: "0.1.2",
  casebookId: casebook.id,
  evidenceCount: 0,
  comparisonGates: [],
  controlledTrackReady: false,
  blockers: ["controlled_evidence_missing"],
  contentSha256: "5".repeat(64),
};

const gate = {
  ...emptyGate,
  evidenceCount: 1,
  evidence,
  comparisonGates,
  advantageGate: evidence.advantageGate,
  blockers: evidence.blockers,
} as ControlledHarnessGateProjection;

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

function findInput(container: HTMLElement): HTMLInputElement {
  const pending = [container];
  while (pending.length > 0) {
    const current = pending.shift()!;
    for (const child of [...current.children]) {
      if (
        child.getAttribute("aria-label") ===
        "Controlled Harness evidence bundle"
      )
        return child as HTMLInputElement;
      pending.push(child as HTMLElement);
    }
  }
  throw new Error("Controlled Harness file input is unavailable");
}
