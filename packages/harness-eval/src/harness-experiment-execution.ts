import type { RunEvent, RunRecord } from "@napier/contracts";
import type {
  HarnessExperiment,
  HarnessExperimentCase,
  HarnessExperimentExecution,
  HarnessExperimentMetric,
  HarnessExperimentProfile,
  HarnessExperimentTrial,
  ModelRouteLock,
} from "@napier/contracts/harness-experiments";

import {
  canonicalJson,
  hashEventStream,
  projectRunHarnessEffectMetrics,
  sha256,
} from "@napier/runtime/harness-eval-support";
import {
  evaluateHarnessExperiment,
  validateHarnessExperiment,
  validateHarnessExperimentTrial,
} from "./harness-experiment-definition.js";

export interface HarnessExperimentTrialEvidence {
  run: RunRecord;
  events: readonly RunEvent[];
  metrics?: Partial<Record<HarnessExperimentMetric, number>>;
}

export interface HarnessExperimentTrialRequest {
  experiment: HarnessExperiment;
  case: HarnessExperimentCase;
  seed: number;
  arm: "baseline" | "candidate";
  profile: HarnessExperimentProfile;
  modelRouteLock: ModelRouteLock;
}

export async function executeHarnessExperiment(input: {
  experiment: HarnessExperiment;
  execute(
    request: HarnessExperimentTrialRequest,
  ): Promise<HarnessExperimentTrialEvidence>;
  clock?: () => Date;
}): Promise<HarnessExperimentExecution> {
  const experiment = validateHarnessExperiment(input.experiment);
  const clock = input.clock ?? (() => new Date());
  const startedAt = clock().toISOString();
  const trials: HarnessExperimentTrial[] = [];
  const runIds = new Set<string>();
  for (const item of experiment.cases) {
    for (const seed of experiment.seeds) {
      for (const arm of ["baseline", "candidate"] as const) {
        const profile =
          arm === "baseline"
            ? experiment.baselineProfile
            : experiment.candidateProfile;
        const evidence = await input.execute({
          experiment,
          case: item,
          seed,
          arm,
          profile,
          modelRouteLock: structuredClone(experiment.modelRouteLock),
        });
        if (runIds.has(evidence.run.id)) {
          throw new Error(
            `Harness experiment Run must be unique: ${evidence.run.id}`,
          );
        }
        runIds.add(evidence.run.id);
        trials.push(
          projectHarnessExperimentTrial({
            experiment,
            case: item,
            seed,
            arm,
            profile,
            ...evidence,
          }),
        );
      }
    }
  }
  const evaluation = evaluateHarnessExperiment(experiment, trials);
  const content = {
    kind: "napier.harness-experiment-execution" as const,
    schemaVersion: 1 as const,
    experimentId: experiment.id,
    experimentSha256: experiment.contentSha256,
    startedAt,
    finishedAt: clock().toISOString(),
    trials,
    evaluation,
  };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

export function projectHarnessExperimentTrial(input: {
  experiment: HarnessExperiment;
  case: HarnessExperimentCase;
  seed: number;
  arm: "baseline" | "candidate";
  profile: HarnessExperimentProfile;
  run: RunRecord;
  events: readonly RunEvent[];
  metrics?: Partial<Record<HarnessExperimentMetric, number>>;
}): HarnessExperimentTrial {
  const events = input.events.filter((event) => event.runId === input.run.id);
  if (events.length !== input.events.length) {
    throw new Error("Harness trial events must belong to exactly one Run");
  }
  if (input.run.status === "queued" || input.run.status === "running") {
    throw new Error("Harness trial Run must be terminal");
  }
  const harness = projectRunHarnessEffectMetrics(
    input.run,
    events,
    hashEventStream(events),
  );
  if (harness.taskInputSha256 !== input.case.inputSha256) {
    throw new Error("Harness trial task input does not match the case set");
  }
  const route = routeEvidence(events);
  const profile = profileEvidence(events, input.profile);
  const projected: Partial<Record<HarnessExperimentMetric, number>> = {
    input_tokens: input.run.usage.inputTokens,
    output_tokens: input.run.usage.outputTokens,
    ...(harness.contextTokens.toolDefinitionEstimatedTokens === undefined
      ? {}
      : {
          tool_schema_tokens:
            harness.contextTokens.toolDefinitionEstimatedTokens,
        }),
    duration_ms: runDurationMs(input.run),
    tool_call_count: harness.toolEfficiency.startedCount,
    ...(harness.toolEfficiency.repeatedCallRate === null
      ? {}
      : { repeated_call_rate: harness.toolEfficiency.repeatedCallRate }),
    ...(harness.toolEfficiency.noNewInformationRate === null
      ? {}
      : {
          no_new_information_rate: harness.toolEfficiency.noNewInformationRate,
        }),
    intervention_count: harness.interventions.count,
    overflow_failed_count: harness.overflow.failedCount,
    evidence_completeness: evidenceCompleteness(input.run, harness, route),
    ...(harness.taskOutcome.status === "unavailable"
      ? {}
      : { task_success: harness.taskOutcome.status === "passed" ? 1 : 0 }),
  };
  const trial: HarnessExperimentTrial = {
    caseId: input.case.id,
    seed: input.seed,
    arm: input.arm,
    runId: input.run.id,
    servingModel: route.servingModel,
    fallbackUsed: route.fallbackUsed,
    profileSha256: profile.profileSha256,
    harnessReceiptSha256: profile.harnessReceiptSha256,
    metrics: { ...projected, ...metricOverrides(input.metrics) },
  };
  validateHarnessExperimentTrial(input.experiment, trial);
  return trial;
}

function profileEvidence(
  events: readonly RunEvent[],
  expected: HarnessExperimentProfile,
): { profileSha256: string; harnessReceiptSha256: string } {
  const applied = events.filter(
    (event) => event.type === "harness.experiment.profile.applied",
  );
  const receipts = events.filter(
    (event) => event.type === "model.harness.resolved",
  );
  if (applied.length !== receipts.length || applied.length === 0) {
    throw new Error("Harness trial experiment profile evidence is incomplete");
  }
  const bindings = applied.map((event, index) => {
    const payload = asRecord(event.payload);
    if (!payload)
      throw new Error("Harness trial experiment profile evidence is invalid");
    const { contentSha256, ...content } = payload;
    const receiptSha256 = stringField(payload, "modelHarnessReceiptSha256");
    if (
      payload["kind"] !== "napier.model-harness-experiment-profile-applied" ||
      payload["schemaVersion"] !== 1 ||
      payload["profileId"] !== expected.id ||
      payload["profileSha256"] !== expected.contentSha256 ||
      payload["maxActiveTools"] !== expected.maxActiveTools ||
      typeof contentSha256 !== "string" ||
      sha256(canonicalJson(content)) !== contentSha256 ||
      !receiptSha256 ||
      receiptSha256 !== stringField(receipts[index]?.payload, "contentSha256")
    ) {
      throw new Error("Harness trial experiment profile evidence is invalid");
    }
    return receiptSha256;
  });
  return {
    profileSha256: expected.contentSha256,
    harnessReceiptSha256: sha256(canonicalJson(bindings)),
  };
}

export function validateHarnessExperimentExecution(
  input: unknown,
  experimentInput: HarnessExperiment,
): HarnessExperimentExecution {
  const experiment = validateHarnessExperiment(experimentInput);
  if (
    !record(input) ||
    input["kind"] !== "napier.harness-experiment-execution" ||
    input["schemaVersion"] !== 1 ||
    input["experimentId"] !== experiment.id ||
    input["experimentSha256"] !== experiment.contentSha256 ||
    typeof input["startedAt"] !== "string" ||
    typeof input["finishedAt"] !== "string"
  ) {
    throw new Error("Harness experiment execution is invalid");
  }
  const trials = array(input["trials"]) as HarnessExperimentTrial[];
  const evaluation = evaluateHarnessExperiment(experiment, trials);
  if (
    !record(input["evaluation"]) ||
    input["evaluation"]["contentSha256"] !== evaluation.contentSha256
  ) {
    throw new Error("Harness experiment execution evaluation is invalid");
  }
  const content = {
    kind: "napier.harness-experiment-execution" as const,
    schemaVersion: 1 as const,
    experimentId: experiment.id,
    experimentSha256: experiment.contentSha256,
    startedAt: input["startedAt"],
    finishedAt: input["finishedAt"],
    trials: structuredClone(trials),
    evaluation,
  };
  if (input["contentSha256"] !== sha256(canonicalJson(content))) {
    throw new Error("Harness experiment execution hash binding is invalid");
  }
  return { ...content, contentSha256: input["contentSha256"] as string };
}

function routeEvidence(events: readonly RunEvent[]): {
  servingModel: { provider: string; id: string };
  fallbackUsed: boolean;
  complete: boolean;
} {
  const attempts = events.filter(
    (event) => event.type === "route_attempt_ended",
  );
  const successful = [...attempts].reverse().find((event) => {
    const payload: unknown = event.payload;
    return record(payload) && payload["outcome"] === "success";
  });
  const payload: unknown = successful?.payload;
  if (!record(payload)) {
    throw new Error("Harness trial requires successful Model Route evidence");
  }
  const provider = payload["providerId"];
  const id = payload["modelId"];
  if (typeof provider !== "string" || typeof id !== "string") {
    throw new Error("Harness trial requires successful Model Route evidence");
  }
  const startedCount = events.filter(
    (event) => event.type === "route_attempt_started",
  ).length;
  return {
    servingModel: { provider, id },
    fallbackUsed: startedCount > 1,
    complete:
      events.some((event) => event.type === "route_plan_created") &&
      startedCount === attempts.length,
  };
}

function metricOverrides(
  metrics: Partial<Record<HarnessExperimentMetric, number>> | undefined,
): Partial<Record<HarnessExperimentMetric, number>> {
  if (!metrics) return {};
  const allowed = new Set<HarnessExperimentMetric>([
    "task_success",
    "evidence_completeness",
  ]);
  if (
    Object.entries(metrics).some(
      ([metric, value]) =>
        !allowed.has(metric as HarnessExperimentMetric) || !finite(value),
    )
  ) {
    throw new Error("Harness trial may only override scored outcome metrics");
  }
  return { ...metrics };
}

function runDurationMs(run: RunRecord): number {
  const start = Date.parse(run.startedAt);
  const finish = run.finishedAt ? Date.parse(run.finishedAt) : Number.NaN;
  if (!Number.isFinite(start) || !Number.isFinite(finish) || finish < start) {
    throw new Error("Harness trial Run duration is invalid");
  }
  return finish - start;
}

function evidenceCompleteness(
  run: RunRecord,
  harness: ReturnType<typeof projectRunHarnessEffectMetrics>,
  route: { complete: boolean },
): number {
  const checks = [
    run.status !== "queued" && run.status !== "running",
    Boolean(run.finishedAt),
    Boolean(harness.taskInputSha256),
    harness.contextTokens.status === "available",
    harness.harnessResolution.status === "available",
    route.complete,
  ];
  return checks.filter(Boolean).length / checks.length;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function record(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringField(value: unknown, key: string): string | undefined {
  const candidate = asRecord(value)?.[key];
  return typeof candidate === "string" ? candidate : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return record(value) ? value : undefined;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value))
    throw new Error("Harness experiment array is invalid");
  return value;
}
