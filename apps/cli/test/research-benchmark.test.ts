import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import {
  canonicalJson,
  createLocalAgentRuntime,
  sha256,
  UnsupportedSandboxAdapter,
  type LocalAgentRuntimeOptions,
} from "@napier/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { loadResearchBenchmarkCase } from "../src/research-benchmark-case.js";
import { verifyResearchBenchmarkArtifacts } from "../src/research-benchmark-contract.js";
import { verifyResearchBenchmarkLedgerBundle } from "../src/research-benchmark-ledger.js";
import {
  createResearchBenchmarkSeries,
  runResearchBenchmarkSeries,
  verifyResearchBenchmarkSeries,
} from "../src/research-benchmark-series.js";
import {
  runResearchBenchmark,
  type ResearchBenchmarkDependencies,
} from "../src/research-benchmark.js";
import type { ResearchBenchmarkLedgerBundle } from "../src/research-benchmark-types.js";

const CASE_ROOT = path.resolve(
  import.meta.dirname,
  "../../../benchmarks/research/aurora-contradiction-v1",
);
const roots: string[] = [];
const CLAIMS = [
  "Project Aurora launched in 2024.",
  "A secondary source claims 2023, conflicting with two primary sources.",
  "Retention is 30 days.",
] as const;

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Research outcome benchmark", () => {
  it("loads fixed hash-bound Sources and hidden claims", async () => {
    const loaded = await loadResearchBenchmarkCase(CASE_ROOT);
    expect(loaded.benchmarkCase).toEqual(
      expect.objectContaining({
        id: "research_aurora_contradiction_v1",
        reportPath: "reports/aurora-brief.md",
        contentSha256:
          "ea32ad0643f15f94529157114a4ebdd5aa6de7c81e03be230d2ce4d3a8e236b9",
      }),
    );
    expect(loaded.sources.sources.map((source) => source.authority)).toEqual([
      "primary",
      "secondary",
      "primary",
    ]);
    expect(loaded.expected.claims).toEqual(CLAIMS);
    expect(loaded.expected.requiredCitations).toHaveLength(7);
  });

  it("captures, cites, verifies, and writes privacy-bounded evidence", async () => {
    const outputDir = await temporaryOutput();
    const provider = researchProvider();
    const artifacts = await runResearchBenchmark(
      {
        caseRoot: CASE_ROOT,
        outputDir,
        model: { provider: "faux-research-benchmark", id: "faux-1" },
        env: {},
      },
      researchDependencies(provider),
    );

    expect(artifacts.result).toEqual(
      expect.objectContaining({
        status: "passed",
        run: expect.objectContaining({ status: "completed" }),
        evaluation: expect.objectContaining({
          claimsMatch: true,
          citationEvidenceMatch: true,
          sourceCaptureMatch: true,
          captureCount: 3,
          citationCount: 7,
          primarySourceCount: 2,
          secondarySourceCount: 1,
          contradictionFound: true,
          reportVerified: true,
          replayValid: true,
          credentialLeakDetected: false,
          diagnostics: [],
        }),
      }),
    );
    expect(
      verifyResearchBenchmarkArtifacts(artifacts.result, artifacts.bundle),
    ).toEqual(expect.objectContaining({ valid: true, diagnostics: [] }));
    const serialized = JSON.stringify(artifacts.bundle);
    for (const raw of [
      ...CLAIMS,
      "Official Aurora",
      "Market Watch",
      "[citation:",
      "reports/aurora-brief.md",
    ]) {
      expect(serialized).not.toContain(raw);
    }

    const wrongSourceKind = structuredClone(
      artifacts.bundle,
    ) as ResearchBenchmarkLedgerBundle;
    const wrongKindCapture = wrongSourceKind.researchEvents.find(
      (event) =>
        record(record(event.payload)?.["details"])?.["action"] === "capture",
    )!;
    record(record(wrongKindCapture.payload)?.["details"])!["sourceKind"] =
      "web_fetch";
    wrongSourceKind.contentSha256 = sha256(
      canonicalJson(withoutHash(wrongSourceKind) as never),
    );
    expect(verifyResearchBenchmarkLedgerBundle(wrongSourceKind)).toEqual(
      expect.objectContaining({
        valid: false,
        diagnostics: expect.arrayContaining(["ledger_shape_invalid"]),
      }),
    );

    const tampered = structuredClone(
      artifacts.bundle,
    ) as ResearchBenchmarkLedgerBundle;
    const capture = tampered.researchEvents.find(
      (event) =>
        record(record(event.payload)?.["details"])?.["action"] === "capture",
    )!;
    const details = record(record(capture.payload)?.["details"])!;
    details["sourceContentSha256"] = "f".repeat(64);
    tampered.contentSha256 = sha256(
      canonicalJson(withoutHash(tampered) as never),
    );
    expect(verifyResearchBenchmarkLedgerBundle(tampered)).toEqual(
      expect.objectContaining({
        valid: false,
        diagnostics: ["ledger_event_binding_invalid"],
      }),
    );
  }, 30_000);

  it("rejects citations bound to the wrong Source evidence", async () => {
    const outputDir = await temporaryOutput();
    const artifacts = await runResearchBenchmark(
      {
        caseRoot: CASE_ROOT,
        outputDir,
        model: { provider: "faux-research-benchmark", id: "faux-1" },
        env: {},
      },
      researchDependencies(researchProvider(1, true)),
    );

    expect(artifacts.result).toEqual(
      expect.objectContaining({
        status: "failed",
        evaluation: expect.objectContaining({
          claimsMatch: true,
          citationCount: 7,
          primarySourceCount: 2,
          secondarySourceCount: 1,
          citationEvidenceMatch: false,
          reportVerified: true,
          diagnostics: ["citation_evidence_mismatch"],
        }),
      }),
    );
    expect(
      verifyResearchBenchmarkArtifacts(artifacts.result, artifacts.bundle),
    ).toEqual(expect.objectContaining({ valid: true, diagnostics: [] }));
  }, 30_000);

  it("aggregates independent trials and rejects ledger substitution", async () => {
    const outputDir = await temporaryOutput();
    const provider = researchProvider(2);
    const artifacts = await runResearchBenchmarkSeries(
      {
        caseRoot: CASE_ROOT,
        outputDir,
        model: { provider: "faux-research-benchmark", id: "faux-1" },
        env: {},
        trialCount: 2,
      },
      researchDependencies(provider),
    );

    expect(
      artifacts.trials.map((trial) => trial.result.evaluation.diagnostics),
    ).toEqual([[], []]);
    expect(artifacts.series).toEqual(
      expect.objectContaining({
        status: "completed",
        completedTrialCount: 2,
        passedTrialCount: 2,
        passRate: 1,
      }),
    );
    const verificationInputs = artifacts.trials.map((trial) => ({
      resultFileName: path.basename(trial.resultPath),
      result: trial.result,
      bundle: trial.bundle,
    }));
    expect(
      verifyResearchBenchmarkSeries(artifacts.series, verificationInputs),
    ).toEqual({
      valid: true,
      diagnostics: [],
      seriesSha256: artifacts.series.contentSha256,
      trialDiagnostics: [
        { index: 1, diagnostics: [] },
        { index: 2, diagnostics: [] },
      ],
    });
    expect(() =>
      createResearchBenchmarkSeries({
        generatedAt: artifacts.series.generatedAt,
        requestedTrialCount: 2,
        status: "completed",
        trials: [artifacts.trials[0]!, artifacts.trials[0]!],
      }),
    ).toThrow("Research benchmark Series trials are inconsistent");
    verificationInputs.push(structuredClone(verificationInputs[1]!));
    expect(
      verifyResearchBenchmarkSeries(artifacts.series, verificationInputs),
    ).toEqual(
      expect.objectContaining({
        valid: false,
        diagnostics: [
          "series_artifact_count_mismatch",
          "series_aggregate_mismatch",
        ],
      }),
    );
    verificationInputs.pop();
    verificationInputs[0]!.bundle = artifacts.trials[1]!.bundle;
    expect(
      verifyResearchBenchmarkSeries(artifacts.series, verificationInputs),
    ).toEqual(
      expect.objectContaining({
        valid: false,
        diagnostics: ["series_trial_invalid", "series_aggregate_mismatch"],
      }),
    );
  }, 30_000);
});

function researchProvider(trialCount = 1, wrongFirstCitation = false) {
  const provider = fauxProvider({ provider: "faux-research-benchmark" });
  const citationPlan = [
    { source: 0, line: 2, claim: CLAIMS[0] },
    { source: 2, line: 2, claim: CLAIMS[0] },
    { source: 0, line: 2, claim: CLAIMS[1] },
    { source: 1, line: 2, claim: CLAIMS[1] },
    { source: 2, line: 2, claim: CLAIMS[1] },
    { source: 0, line: 3, claim: CLAIMS[2] },
    { source: 2, line: 3, claim: CLAIMS[2] },
  ] as const;
  const respond = (context: { messages: unknown[] }) => {
    const messages = JSON.stringify(context.messages);
    const capturedSources = sourceBindings(messages, false);
    const tokens = citationTokens(messages);
    if (capturedSources.length < 3) {
      return toolResponse("research_source", {
        action: "capture",
        maxChars: 12000,
      });
    }
    if (tokens.length < citationPlan.length) {
      const expectedPlan = citationPlan[tokens.length]!;
      const plan =
        wrongFirstCitation && tokens.length === 0
          ? { ...expectedPlan, source: 1 }
          : expectedPlan;
      const source = capturedSources[plan.source]!;
      return toolResponse("research_source", {
        action: "cite",
        sourceId: source.id,
        sourceContentSha256: source.sha256,
        startLine: plan.line,
        endLine: plan.line,
        claim: plan.claim,
      });
    }
    if (!messages.includes("Research Sources: 3")) {
      return toolResponse("research_source", { action: "list" });
    }
    const report = researchReport(tokens);
    if (!messages.includes("Created reports/aurora-brief.md atomically.")) {
      return toolResponse("apply_patch", {
        operation: "create",
        path: "reports/aurora-brief.md",
        expectedSha256: null,
        content: report,
        createParentDirectories: true,
      });
    }
    if (!messages.includes("Research report verified:")) {
      return toolResponse("research_source", {
        action: "verify_report",
        path: "reports/aurora-brief.md",
        expectedSha256: sha256(report),
      });
    }
    if (!messages.includes("The verified research brief is complete.")) {
      return fauxAssistantMessage("The verified research brief is complete.");
    }
    return fauxAssistantMessage('{"facts":[]}');
  };
  provider.setResponses(Array.from({ length: 16 * trialCount }, () => respond));
  return provider;
}

function toolResponse(toolName: string, input: Record<string, unknown>) {
  return fauxAssistantMessage(fauxToolCall(toolName, input), {
    stopReason: "toolUse",
  });
}

function sourceBindings(messages: string, assertComplete = true) {
  const ids = [
    ...new Set(
      [...messages.matchAll(/Research Source: (source_[a-z0-9]+)/gu)].map(
        (match) => match[1]!,
      ),
    ),
  ];
  const hashes = [
    ...new Set(
      [...messages.matchAll(/Capture SHA-256: ([a-f0-9]{64})/gu)].map(
        (match) => match[1]!,
      ),
    ),
  ];
  if (assertComplete) {
    expect(ids).toHaveLength(3);
    expect(hashes).toHaveLength(3);
  }
  return ids.map((id, index) => ({ id, sha256: hashes[index]! }));
}

function citationTokens(messages: string) {
  return [
    ...new Set(
      [...messages.matchAll(/\[citation:citation_[a-z0-9]{8,80}\]/gu)].map(
        (match) => match[0],
      ),
    ),
  ];
}

function researchReport(tokens: string[]) {
  expect(tokens).toHaveLength(7);
  return [
    "# Aurora Research Brief",
    "",
    `${CLAIMS[0]} ${tokens[0]} ${tokens[1]}`,
    `${CLAIMS[1]} ${tokens[2]} ${tokens[3]} ${tokens[4]}`,
    `${CLAIMS[2]} ${tokens[5]} ${tokens[6]}`,
    "",
    "## Evidence Ledger",
    "",
    `- Citation IDs: ${tokens.map((token) => token.slice(10, -1)).join(", ")}`,
    "",
  ].join("\n");
}

function researchDependencies(
  provider: ReturnType<typeof researchProvider>,
): ResearchBenchmarkDependencies {
  return {
    now: () => new Date("2026-08-02T00:00:00.000Z"),
    async createRuntime(options: LocalAgentRuntimeOptions) {
      const runtime = await createLocalAgentRuntime({
        ...options,
        sandbox: new UnsupportedSandboxAdapter("research-benchmark-test"),
      });
      runtime.models.registerProvider(provider.provider);
      return runtime;
    },
  };
}

async function temporaryOutput(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-research-output-"));
  roots.push(root);
  return root;
}

function withoutHash<T extends { contentSha256: string }>(
  value: T,
): Omit<T, "contentSha256"> {
  const { contentSha256: _contentSha256, ...content } = value;
  return content;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
