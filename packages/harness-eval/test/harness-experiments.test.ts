import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import {
  AgentRuntime,
  canonicalJson,
  ModelRegistry,
  LocalStore,
  sha256,
  type OsSandboxAdapter,
  type SandboxedProcess,
  type SandboxLaunchRequest,
} from "@napier/runtime";
import {
  createHarnessExperiment,
  createHarnessExperimentReleaseEvidence,
  createModelHarnessExperimentProfile,
  evaluateHarnessExperiment,
  executeHarnessExperiment,
  projectHarnessExperimentTrial,
  validateHarnessExperiment,
  validateHarnessExperimentExecution,
  validateHarnessExperimentReleaseEvidence,
} from "../src/harness-experiments.js";

const caseInputs = new Map(
  Array.from({ length: 30 }, (_, index) => {
    const id = `case_${String(index + 1)}`;
    return [id, `Execute deterministic Harness case ${id}.`] as const;
  }),
);
const cases = [...caseInputs].map(([id, text], index) => ({
  id,
  inputSha256: sha256(text),
  tags: index < 15 ? ["research"] : ["coding"],
}));
const temporaryRoots: string[] = [];

function processReadySandbox(id: string): OsSandboxAdapter {
  return {
    id,
    launch(request: SandboxLaunchRequest): Promise<SandboxedProcess> {
      if (
        !request.args.some((argument) =>
          argument.includes("napier_shell_probe_v1"),
        )
      ) {
        return Promise.reject(
          new Error("Harness Eval fixture does not execute commands"),
        );
      }
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      void Promise.resolve().then(() => {
        stdout.end("napier_shell_probe_v1");
        stderr.end();
      });
      return Promise.resolve({
        stdin,
        stdout,
        stderr,
        exit: Promise.resolve({ code: 0, signal: null }),
        terminate: async () => undefined,
      });
    },
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Harness experiments", () => {
  it("binds a 30-case, 3-seed experiment to distinct runtime profiles", () => {
    const experiment = fixtureExperiment();
    expect(validateHarnessExperiment(experiment)).toEqual(experiment);
    expect(experiment.cases).toHaveLength(30);
    expect(experiment.seeds).toEqual([11, 22, 33]);
    expect(experiment.caseSetDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(experiment.contentSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("separates fallback and serving-model drift from same-model decisions", () => {
    const experiment = fixtureExperiment();
    const trials = experiment.cases.flatMap((item) =>
      experiment.seeds.flatMap((seed) => [
        trial(item.id, seed, "baseline", 1, 0.2),
        trial(item.id, seed, "candidate", 1, 0.1),
      ]),
    );
    trials.find(
      (item) =>
        item.caseId === "case_1" &&
        item.seed === 11 &&
        item.arm === "candidate",
    )!.fallbackUsed = true;
    trials.find(
      (item) =>
        item.caseId === "case_2" &&
        item.seed === 11 &&
        item.arm === "candidate",
    )!.servingModel = { provider: "other", id: "model" };

    const evaluation = evaluateHarnessExperiment(experiment, trials);
    expect(evaluation).toEqual(
      expect.objectContaining({
        expectedPairCount: 90,
        comparablePairCount: 88,
        fallbackPairCount: 1,
        servingModelMismatchPairCount: 1,
        verdict: "insufficient_evidence",
      }),
    );
  });

  it("reports improvement only when every fixed-model pair is present", () => {
    const experiment = fixtureExperiment();
    const trials = experiment.cases.flatMap((item) =>
      experiment.seeds.flatMap((seed) => [
        trial(item.id, seed, "baseline", 1, 0.2),
        trial(item.id, seed, "candidate", 1, 0.1),
      ]),
    );
    const evaluation = evaluateHarnessExperiment(experiment, trials);
    expect(evaluation.verdict).toBe("improved");
    expect(evaluation.primary).toEqual([
      expect.objectContaining({
        metric: "task_success",
        status: "passed",
        delta: 0,
      }),
      expect.objectContaining({
        metric: "repeated_call_rate",
        status: "passed",
        delta: expect.closeTo(-0.1),
      }),
    ]);
  });

  it("isolates a trial whose runtime profile does not match its matrix arm", () => {
    const experiment = fixtureExperiment();
    const trials = experiment.cases.flatMap((item) =>
      experiment.seeds.flatMap((seed) => [
        trial(item.id, seed, "baseline", 1, 0.2),
        trial(item.id, seed, "candidate", 1, 0.1),
      ]),
    );
    trials.find(
      (item) =>
        item.caseId === "case_1" &&
        item.seed === 11 &&
        item.arm === "candidate",
    )!.profileSha256 = experiment.baselineProfile.contentSha256;

    expect(evaluateHarnessExperiment(experiment, trials)).toEqual(
      expect.objectContaining({
        expectedPairCount: 90,
        comparablePairCount: 89,
        profileMismatchPairCount: 1,
        verdict: "insufficient_evidence",
      }),
    );
  });

  it("rejects one Run reused across different matrix cells", () => {
    const experiment = fixtureExperiment();
    const baseline = trial("case_1", 11, "baseline", 1, 0.2);
    const candidate = trial("case_1", 11, "candidate", 1, 0.1);
    candidate.runId = baseline.runId;

    expect(() =>
      evaluateHarnessExperiment(experiment, [baseline, candidate]),
    ).toThrow(`Duplicate Harness experiment Run: ${baseline.runId}`);
  });

  it("rejects undersized or duplicate-seed templates", () => {
    expect(() =>
      createHarnessExperiment({
        ...fixtureInput(),
        cases: cases.slice(0, 29),
      }),
    ).toThrow("30-100 cases");
    expect(() =>
      createHarnessExperiment({
        ...fixtureInput(),
        seeds: [11, 11, 22],
      }),
    ).toThrow("seeds must be unique");
  });

  it("executes the complete fixed-model matrix as 180 profile-bound Runs", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-harness-experiment-"),
    );
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const store = new LocalStore({
      workspaceRoot,
      dataRoot: path.join(root, "data"),
    });
    await store.initialize();
    const provider = fauxProvider({
      provider: "fixture",
      models: [{ id: "fixed" }],
    });
    provider.setResponses(
      Array.from({ length: 360 }, () => fauxAssistantMessage('{"facts":[]}')),
    );
    const models = new ModelRegistry();
    models.registerProvider(provider.provider);
    const runtime = new AgentRuntime(
      store,
      models,
      undefined,
      processReadySandbox("harness-eval-test"),
    );
    const experiment = fixtureExperiment({
      primaryMetrics: ["task_success"],
    });
    const requests: Array<{
      caseId: string;
      seed: number;
      arm: "baseline" | "candidate";
      profileSha256: string;
    }> = [];
    const routeEventsByRun = new Map<string, string[]>();

    try {
      const execution = await executeHarnessExperiment({
        experiment,
        execute: async (request) => {
          expect(request.modelRouteLock).toEqual(experiment.modelRouteLock);
          requests.push({
            caseId: request.case.id,
            seed: request.seed,
            arm: request.arm,
            profileSha256: request.profile.contentSha256,
          });
          const text = caseInputs.get(request.case.id);
          expect(text).toBeDefined();
          const thread = await store.createThread({
            title: `Harness ${request.case.id} ${String(request.seed)} ${request.arm}`,
            agentId: store.listAgents()[0]!.id,
          });
          const run = await runtime.runPrompt({
            threadId: thread.id,
            text: text!,
            model: request.modelRouteLock.servingModel,
            modelRoute: {
              role: request.modelRouteLock.role,
              fallbackModels: [],
            },
            harnessExperimentProfile: request.profile,
          });
          expect(run.status, run.error).toBe("completed");
          const events = (await store.listEvents(thread.id)).filter(
            (event) => event.runId === run.id,
          );
          if (
            request.case.id === "case_1" &&
            request.seed === 11 &&
            request.arm === "baseline"
          ) {
            const tamperedEvents = structuredClone(events);
            const applied = tamperedEvents.find(
              (event) => event.type === "harness.experiment.profile.applied",
            );
            expect(applied).toBeDefined();
            const payload = applied!.payload as Record<string, unknown>;
            payload["modelHarnessReceiptSha256"] = "f".repeat(64);
            const { contentSha256: _ignored, ...content } = payload;
            payload["contentSha256"] = sha256(canonicalJson(content));
            expect(() =>
              projectHarnessExperimentTrial({
                experiment,
                case: request.case,
                seed: request.seed,
                arm: request.arm,
                profile: request.profile,
                run,
                events: tamperedEvents,
                metrics: { task_success: 1 },
              }),
            ).toThrow("Harness trial experiment profile evidence is invalid");
          }
          routeEventsByRun.set(
            run.id,
            events
              .filter((event) => event.type.startsWith("route_"))
              .map((event) => event.type),
          );
          return { run, events, metrics: { task_success: 1 } };
        },
      });

      expect(requests).toEqual(
        experiment.cases.flatMap((item) =>
          experiment.seeds.flatMap((seed) => [
            {
              caseId: item.id,
              seed,
              arm: "baseline",
              profileSha256: experiment.baselineProfile.contentSha256,
            },
            {
              caseId: item.id,
              seed,
              arm: "candidate",
              profileSha256: experiment.candidateProfile.contentSha256,
            },
          ]),
        ),
      );
      expect(execution.trials).toHaveLength(180);
      expect(new Set(execution.trials.map((trial) => trial.runId)).size).toBe(
        180,
      );
      expect(
        execution.trials.every(
          (trial) =>
            trial.servingModel.provider === "fixture" &&
            trial.servingModel.id === "fixed" &&
            trial.fallbackUsed === false &&
            trial.metrics.task_success === 1 &&
            trial.metrics.evidence_completeness === 1,
        ),
      ).toBe(true);
      expect([...routeEventsByRun.values()]).toEqual(
        Array.from({ length: 180 }, () => [
          "route_plan_created",
          "route_attempt_started",
          "route_attempt_ended",
        ]),
      );
      expect(execution.evaluation).toEqual(
        expect.objectContaining({
          expectedPairCount: 90,
          comparablePairCount: 90,
          fallbackPairCount: 0,
          servingModelMismatchPairCount: 0,
          profileMismatchPairCount: 0,
          missingPairCount: 0,
          verdict: "no_difference",
        }),
      );
      expect(validateHarnessExperimentExecution(execution, experiment)).toEqual(
        execution,
      );
      expect(execution.contentSha256).toMatch(/^[a-f0-9]{64}$/u);
    } finally {
      store.close();
    }
  }, 120_000);

  it("binds execution trends and controlled regression attribution into release evidence", () => {
    const experiment = fixtureExperiment();
    const previous = execution(
      experiment,
      "2026-08-20T00:00:00.000Z",
      "no_difference",
    );
    const latest = execution(
      experiment,
      "2026-08-21T00:00:00.000Z",
      "regressed",
    );
    const binding = {
      sourceManifestSha256: "a".repeat(64),
      configurationSha256: "b".repeat(64),
      credentialClass: "workload_identity",
    };

    const evidence = createHarnessExperimentReleaseEvidence({
      generatedAt: "2026-08-22T00:00:00.000Z",
      productVersion: "0.2.0",
      experiment,
      executions: [latest, previous],
      bindings: [
        { executionSha256: latest.contentSha256, ...binding },
        { executionSha256: previous.contentSha256, ...binding },
      ],
    });

    expect(evidence.trend.map((point) => point.verdict)).toEqual([
      "no_difference",
      "regressed",
    ]);
    expect(evidence.regressionAttribution).toEqual({
      status: "controlled_candidate_regression",
      latestExecutionSha256: latest.contentSha256,
      previousExecutionSha256: previous.contentSha256,
      factors: ["candidate_profile"],
    });
    expect(evidence.promotionReady).toBe(false);
    expect(evidence.blockers).toEqual(["latest_experiment_regressed"]);
    expect(validateHarnessExperimentReleaseEvidence(evidence)).toEqual(
      evidence,
    );
  });

  it("fails promotion closed when a regression is confounded by release drift", () => {
    const experiment = fixtureExperiment();
    const previous = execution(
      experiment,
      "2026-08-20T00:00:00.000Z",
      "no_difference",
    );
    const latest = execution(
      experiment,
      "2026-08-21T00:00:00.000Z",
      "regressed",
    );
    const evidence = createHarnessExperimentReleaseEvidence({
      generatedAt: "2026-08-22T00:00:00.000Z",
      productVersion: "0.2.0",
      experiment,
      executions: [previous, latest],
      bindings: [
        {
          executionSha256: previous.contentSha256,
          sourceManifestSha256: "a".repeat(64),
          configurationSha256: "b".repeat(64),
          credentialClass: "workload_identity",
        },
        {
          executionSha256: latest.contentSha256,
          sourceManifestSha256: "c".repeat(64),
          configurationSha256: "b".repeat(64),
          credentialClass: "workload_identity",
        },
      ],
    });

    expect(evidence.regressionAttribution).toEqual(
      expect.objectContaining({
        status: "confounded",
        factors: ["source_manifest"],
      }),
    );
    expect(evidence.blockers).toEqual([
      "release_control_drift:source_manifest",
      "latest_experiment_regressed",
      "regression_attribution_confounded",
    ]);
  });

  it("blocks release when tool schema token reduction is below 35 percent", () => {
    const experiment = fixtureExperiment();
    const previous = execution(
      experiment,
      "2026-08-20T00:00:00.000Z",
      "no_difference",
    );
    const latest = execution(
      experiment,
      "2026-08-21T00:00:00.000Z",
      "no_difference",
      80,
    );
    const binding = {
      sourceManifestSha256: "a".repeat(64),
      configurationSha256: "b".repeat(64),
      credentialClass: "workload_identity",
    };

    const evidence = createHarnessExperimentReleaseEvidence({
      generatedAt: "2026-08-22T00:00:00.000Z",
      productVersion: "0.2.0",
      experiment,
      executions: [previous, latest],
      bindings: [
        { executionSha256: previous.contentSha256, ...binding },
        { executionSha256: latest.contentSha256, ...binding },
      ],
    });

    expect(evidence.promotionReady).toBe(false);
    expect(evidence.blockers).toEqual([
      "tool_schema_token_reduction_below_35_percent",
    ]);
  });
});

function fixtureInput() {
  return {
    id: "route_safe_failover_v1",
    baselineProfile: createModelHarnessExperimentProfile({
      id: "route-v0",
      maxActiveTools: 20,
    }),
    candidateProfile: createModelHarnessExperimentProfile({
      id: "route-v1",
      maxActiveTools: 12,
    }),
    cases,
    modelRouteLock: {
      role: "default" as const,
      servingModel: { provider: "fixture", id: "fixed" },
      fallbackSamples: "separate_stratum" as const,
    },
    seeds: [11, 22, 33],
    primaryMetrics: ["task_success", "repeated_call_rate"] as const,
    guardrailMetrics: ["intervention_count"] as const,
  };
}

function fixtureExperiment(
  overrides: Partial<ReturnType<typeof fixtureInput>> = {},
) {
  const input = fixtureInput();
  return createHarnessExperiment({
    ...input,
    ...overrides,
    primaryMetrics: [...input.primaryMetrics],
    ...(overrides.primaryMetrics
      ? { primaryMetrics: [...overrides.primaryMetrics] }
      : {}),
    guardrailMetrics: [...input.guardrailMetrics],
    ...(overrides.guardrailMetrics
      ? { guardrailMetrics: [...overrides.guardrailMetrics] }
      : {}),
  });
}

function trial(
  caseId: string,
  seed: number,
  arm: "baseline" | "candidate",
  taskSuccess: number,
  repeatedCallRate: number,
  candidateToolSchemaTokens = 60,
) {
  return {
    caseId,
    seed,
    arm,
    runId: `run_${caseId}_${String(seed)}_${arm}`,
    servingModel: { provider: "fixture", id: "fixed" },
    fallbackUsed: false,
    profileSha256:
      arm === "baseline"
        ? fixtureInput().baselineProfile.contentSha256
        : fixtureInput().candidateProfile.contentSha256,
    harnessReceiptSha256: sha256(
      canonicalJson([`${caseId}:${String(seed)}:${arm}`]),
    ),
    metrics: {
      task_success: taskSuccess,
      tool_schema_tokens: arm === "baseline" ? 100 : candidateToolSchemaTokens,
      repeated_call_rate: repeatedCallRate,
      intervention_count: 0,
    },
  };
}

function execution(
  experiment: ReturnType<typeof fixtureExperiment>,
  finishedAt: string,
  verdict: "no_difference" | "regressed",
  candidateToolSchemaTokens = 60,
) {
  const delta = verdict === "regressed" ? -0.1 : 0;
  const trials = experiment.cases.flatMap((item) =>
    experiment.seeds.flatMap((seed) => [
      trial(item.id, seed, "baseline", 1, 0.1),
      trial(
        item.id,
        seed,
        "candidate",
        verdict === "regressed" ? 0.9 : 1,
        0.1,
        candidateToolSchemaTokens,
      ),
    ]),
  );
  const evaluation = evaluateHarnessExperiment(experiment, trials);
  expect(evaluation.verdict).toBe(verdict);
  expect(evaluation.primary[0]?.delta).toBeCloseTo(delta);
  const content = {
    kind: "napier.harness-experiment-execution" as const,
    schemaVersion: 1 as const,
    experimentId: experiment.id,
    experimentSha256: experiment.contentSha256,
    startedAt: new Date(Date.parse(finishedAt) - 1_000).toISOString(),
    finishedAt,
    trials,
    evaluation,
  };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}
