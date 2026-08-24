import type {
  AgentHarnessAcceptanceEvidenceContent,
  AgentHarnessAcceptanceSummary,
  HarnessLedgerEventEvidence,
  HarnessLedgerRunEvidence,
} from "@napier/contracts/agent-harness-acceptance";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  governedBridgeCall,
  privilegeProbeBlocked,
} from "./agent-harness-code-bridge-projection.js";

const TERMINAL = /^(?:completed|failed|cancelled|timed_out|orphaned)$/u;

export function projectAgentHarnessAcceptanceSummary(
  input: AgentHarnessAcceptanceEvidenceContent,
): AgentHarnessAcceptanceSummary {
  const runs = new Map(
    input.ledgerRuns.map((run) => [run.contentSha256, run] as const),
  );
  const recoverable = input.routeCases.filter(
    (item) => item.scenario === "recoverable",
  );
  const recovered = recoverable.filter((item) =>
    routeRecovered(requireRun(runs, item.runEvidenceSha256), item.failureClass),
  ).length;
  const routeResponses = input.routeCases.flatMap((item) =>
    events(requireRun(runs, item.runEvidenceSha256), "model.response"),
  );
  const attributedResponses = input.routeCases.flatMap((item) => {
    const run = requireRun(runs, item.runEvidenceSha256);
    return events(run, "model.response").filter((event) =>
      responseAttributed(event, run),
    );
  });
  const loopCounts = input.loopPairs.map((item) => ({
    baseline: toolLoopCounts(requireRun(runs, item.baselineRunEvidenceSha256)),
    candidate: toolLoopCounts(
      requireRun(runs, item.candidateRunEvidenceSha256),
    ),
  }));
  const bridgeGoverned = input.codeBridgeCalls.filter((item) =>
    governedBridgeCall(requireRun(runs, item.runEvidenceSha256), item.callId),
  ).length;
  const durableTasks = input.subagentTasks.filter((item) =>
    durableSubagentTask(requireRun(runs, item.runEvidenceSha256), item),
  ).length;
  const tokenRatios = tokenCalibrationRatios(input, runs);
  return {
    routeRecoverySampleCount: recoverable.length,
    routeRecoveryRate: rate(recovered, recoverable.length),
    visibleOutputCrossModelContinuationCount: routeUnsafeContinuations(
      input,
      runs,
      "visible_output",
    ),
    unknownSideEffectReplayCount: routeUnsafeContinuations(
      input,
      runs,
      "unknown_side_effect",
    ),
    routeAttributionRate: rate(
      attributedResponses.length,
      routeResponses.length,
    ),
    capabilityUnreachableRate: rate(
      input.capabilityReachabilityCases.filter(
        (item) =>
          !capabilityReached(
            requireRun(runs, item.runEvidenceSha256),
            item.targetToolId,
          ),
      ).length,
      input.capabilityReachabilityCases.length,
    ),
    repeatedCallReduction: reduction(
      sum(loopCounts.map((item) => item.baseline.repeated)),
      sum(loopCounts.map((item) => item.candidate.repeated)),
    ),
    noNewInformationReduction: reduction(
      sum(loopCounts.map((item) => item.baseline.noNewInformation)),
      sum(loopCounts.map((item) => item.candidate.noNewInformation)),
    ),
    codeBridgeGovernanceCoverage: rate(
      bridgeGoverned,
      input.codeBridgeCalls.length,
    ),
    privilegeExpansionCount: input.codeBridgePrivilegeProbes.filter(
      (item) =>
        !privilegeProbeBlocked(
          requireRun(runs, item.runEvidenceSha256),
          item.callId,
          item.probeClass,
        ),
    ).length,
    subagentDurableTerminalRate: rate(durableTasks, input.subagentTasks.length),
    steeringBoundarySuccessRate: rate(
      input.steeringBoundaryChecks.filter((item) =>
        steeringReachedBoundary(
          requireRun(runs, item.runEvidenceSha256),
          item.taskId,
          item.messageId,
        ),
      ).length,
      input.steeringBoundaryChecks.length,
    ),
    cancellationBoundarySuccessRate: rate(
      input.cancellationBoundaryChecks.filter((item) =>
        cancellationReachedBoundary(
          requireRun(runs, item.runEvidenceSha256),
          item.taskId,
          item.requestEventId,
          item.terminalEventId,
        ),
      ).length,
      input.cancellationBoundaryChecks.length,
    ),
    tokenModelP95: input.primaryModels.map((model) => {
      const samples = tokenRatios.filter(
        (item) => item.provider === model.provider && item.model === model.id,
      );
      return {
        ...model,
        sampleCount: samples.length,
        p95UnderestimateRatio: percentile95(samples.map((item) => item.ratio)),
      };
    }),
    conservativeTokenFallbackVerified: fallbackVerified(input, runs),
  };
}

function routeRecovered(
  run: HarnessLedgerRunEvidence,
  failureClass: string,
): boolean {
  const ended = events(run, "route_attempt_ended");
  const failedIndex = ended.findIndex(
    (event) =>
      field(event.payload, "failureClass") === failureClass &&
      field(event.payload, "outcome") === "retryable" &&
      field(event.payload, "visibleOutputProduced") === false &&
      field(event.payload, "sideEffectState") === "none",
  );
  return (
    failedIndex >= 0 &&
    ended
      .slice(failedIndex + 1)
      .some((event) => field(event.payload, "outcome") === "success")
  );
}

function routeUnsafeContinuations(
  input: AgentHarnessAcceptanceEvidenceContent,
  runs: ReadonlyMap<string, HarnessLedgerRunEvidence>,
  scenario: "visible_output" | "unknown_side_effect",
): number {
  return input.routeCases.filter((item) => {
    if (item.scenario !== scenario) return false;
    const attempts = events(
      requireRun(runs, item.runEvidenceSha256),
      "route_attempt_ended",
    );
    const barrierIndex = attempts.findIndex((event) =>
      scenario === "visible_output"
        ? field(event.payload, "visibleOutputProduced") === true
        : field(event.payload, "sideEffectState") === "unknown",
    );
    return barrierIndex >= 0 && attempts.slice(barrierIndex + 1).length > 0;
  }).length;
}

function responseAttributed(
  response: HarnessLedgerEventEvidence,
  run: HarnessLedgerRunEvidence,
): boolean {
  const model = field(response.payload, "model");
  return (
    typeof model === "string" &&
    events(run, "route_attempt_ended").some(
      (event) =>
        event.seq < response.seq &&
        `${String(field(event.payload, "providerId"))}/${String(field(event.payload, "modelId"))}` ===
          model,
    )
  );
}

function capabilityReached(
  run: HarnessLedgerRunEvidence,
  toolId: string,
): boolean {
  const harness = events(run, "model.harness.resolved");
  const omitted = harness.findIndex((event) =>
    stringArray(field(event.payload, "omittedToolNames")).includes(toolId),
  );
  const resolved = events(run, "tool.completed").find(
    (event) =>
      event.seq > (harness[omitted]?.seq ?? 0) &&
      field(event.payload, "toolName") === "capability" &&
      JSON.stringify(event.payload).includes(toolId),
  );
  return (
    omitted >= 0 &&
    Boolean(resolved) &&
    harness.some(
      (event) =>
        event.seq > resolved!.seq &&
        stringArray(field(event.payload, "activeToolNames")).includes(toolId),
    )
  );
}

function toolLoopCounts(run: HarnessLedgerRunEvidence): {
  repeated: number;
  noNewInformation: number;
} {
  const terminals = events(run, "tool.completed");
  const startedInputs = new Map(
    events(run, "tool.started").flatMap((event) => {
      const callId = field(event.payload, "callId");
      const input =
        field(event.payload, "callInputSha256") ??
        field(event.payload, "inputSha256");
      return typeof callId === "string" && typeof input === "string"
        ? [[callId, input] as const]
        : [];
    }),
  );
  const seenCalls = new Set<string>();
  const seenResults = new Set<string>();
  let repeated = 0;
  let noNewInformation = 0;
  for (const event of terminals) {
    const call =
      field(event.payload, "callInputSha256") ??
      field(event.payload, "inputSha256") ??
      startedInputs.get(String(field(event.payload, "callId") ?? ""));
    const result =
      field(event.payload, "resultSha256") ??
      field(event.payload, "outputSha256") ??
      field(event.payload, "outputTextSha256");
    if (typeof call === "string" && seenCalls.has(call)) repeated += 1;
    if (typeof result === "string" && seenResults.has(result))
      noNewInformation += 1;
    if (typeof call === "string") seenCalls.add(call);
    if (typeof result === "string") seenResults.add(result);
  }
  return { repeated, noNewInformation };
}

function durableSubagentTask(
  run: HarnessLedgerRunEvidence,
  item: AgentHarnessAcceptanceEvidenceContent["subagentTasks"][number],
): boolean {
  const terminal = run.events.find(
    (event) => event.id === item.terminalEventId,
  );
  const snapshot = item.restartSnapshot;
  return Boolean(
    terminal &&
    terminal.type === `subagent.${snapshot.status}` &&
    field(terminal.payload, "taskId") === item.taskId &&
    field(terminal.payload, "status") === snapshot.status &&
    snapshot.taskId === item.taskId &&
    TERMINAL.test(snapshot.status),
  );
}

function steeringReachedBoundary(
  run: HarnessLedgerRunEvidence,
  taskId: string,
  messageId: string,
): boolean {
  const accepted = events(run, "subagent.message.accepted").find(
    (event) =>
      field(event.payload, "taskId") === taskId &&
      field(event.payload, "id") === messageId,
  );
  const delivered = events(run, "subagent.message.delivered").find(
    (event) =>
      field(event.payload, "taskId") === taskId &&
      field(event.payload, "messageId") === messageId,
  );
  const terminal = run.events.find(
    (event) =>
      event.type.startsWith("subagent.") &&
      TERMINAL.test(event.type.slice(9)) &&
      field(event.payload, "taskId") === taskId,
  );
  return Boolean(
    accepted &&
    delivered &&
    terminal &&
    accepted.seq < delivered.seq &&
    delivered.seq < terminal.seq,
  );
}

function cancellationReachedBoundary(
  run: HarnessLedgerRunEvidence,
  taskId: string,
  requestEventId: string,
  terminalEventId: string,
): boolean {
  const requested = run.events.find(
    (event) =>
      event.id === requestEventId &&
      event.type === "subagent.cancel.requested" &&
      field(event.payload, "taskId") === taskId,
  );
  const terminal = run.events.find(
    (event) =>
      event.id === terminalEventId &&
      event.type === "subagent.cancelled" &&
      field(event.payload, "taskId") === taskId,
  );
  return Boolean(requested && terminal && requested.seq < terminal.seq);
}

function tokenCalibrationRatios(
  input: AgentHarnessAcceptanceEvidenceContent,
  runs: ReadonlyMap<string, HarnessLedgerRunEvidence>,
): Array<{ provider: string; model: string; ratio: number }> {
  return input.tokenCalibrationObservations.flatMap((item) => {
    const event = requireRun(runs, item.runEvidenceSha256).events.find(
      (candidate) => candidate.id === item.calibrationEventId,
    );
    if (!event || event.type !== "model.context.token_calibration") return [];
    const payload = record(event.payload) ? event.payload : {};
    const { contentSha256, ...content } = payload;
    const estimated = Number(payload["estimatedInputTokens"]);
    const actual = Number(payload["actualInputTokens"]);
    const ratio = roundRatio(Math.max(0, actual - estimated) / actual);
    if (
      payload["status"] !== "calibrated" ||
      payload["provider"] !== item.provider ||
      payload["model"] !== item.model ||
      payload["contentClass"] !== item.contentClass ||
      !positiveInteger(estimated) ||
      !positiveInteger(actual) ||
      payload["underestimateRatio"] !== ratio ||
      contentSha256 !== sha256(canonicalJson(content))
    )
      return [];
    return [{ provider: item.provider, model: item.model, ratio }];
  });
}

function fallbackVerified(
  input: AgentHarnessAcceptanceEvidenceContent,
  runs: ReadonlyMap<string, HarnessLedgerRunEvidence>,
): boolean {
  const probe = input.conservativeTokenFallbackProbe;
  const event = requireRun(runs, probe.runEvidenceSha256).events.find(
    (candidate) => candidate.id === probe.eventId,
  );
  return Boolean(
    event &&
    event.type === "model.context.token_pressure" &&
    field(event.payload, "meterProviderId") ===
      "napier.conservative-heuristic" &&
    field(event.payload, "fallbackApplied") === true &&
    Number(field(event.payload, "activeBaseEstimatedInputTokens")) > 0,
  );
}

function requireRun(
  runs: ReadonlyMap<string, HarnessLedgerRunEvidence>,
  hash: string,
): HarnessLedgerRunEvidence {
  const run = runs.get(hash);
  if (!run) throw new Error("Agent Harness acceptance run binding is invalid");
  return run;
}

function events(run: HarnessLedgerRunEvidence, type: string) {
  return run.events.filter((event) => event.type === type);
}

function field(value: unknown, key: string): unknown {
  return record(value) ? value[key] : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function reduction(baseline: number, candidate: number): number {
  return baseline > 0 ? (baseline - candidate) / baseline : 0;
}

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function percentile95(values: readonly number[]): number {
  if (values.length === 0) return 1;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]!;
}

function roundRatio(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
