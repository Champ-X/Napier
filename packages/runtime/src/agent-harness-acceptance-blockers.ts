import type {
  AgentHarnessAcceptanceEvidenceContent,
  AgentHarnessAcceptanceSummary,
} from "@napier/contracts/agent-harness-acceptance";

export function acceptanceBlockers(
  input: AgentHarnessAcceptanceEvidenceContent,
  summary: AgentHarnessAcceptanceSummary,
): string[] {
  return [
    ...routeBlockers(summary),
    ...toolBlockers(input, summary),
    ...subagentBlockers(input, summary),
    ...tokenBlockers(input, summary),
  ];
}

function routeBlockers(summary: AgentHarnessAcceptanceSummary): string[] {
  const blockers: string[] = [];
  if (summary.routeRecoverySampleCount < 100)
    blockers.push("route_recovery_sample_below_100");
  if (summary.routeRecoveryRate < 0.95)
    blockers.push("route_recovery_below_95_percent");
  if (summary.visibleOutputCrossModelContinuationCount !== 0)
    blockers.push("visible_output_cross_model_continuation");
  if (summary.unknownSideEffectReplayCount !== 0)
    blockers.push("unknown_side_effect_replay");
  if (summary.routeAttributionRate !== 1)
    blockers.push("route_attribution_incomplete");
  return blockers;
}

function toolBlockers(
  input: AgentHarnessAcceptanceEvidenceContent,
  summary: AgentHarnessAcceptanceSummary,
): string[] {
  const blockers: string[] = [];
  if (input.capabilityReachabilityCases.length < 100)
    blockers.push("capability_reachability_sample_below_100");
  if (summary.capabilityUnreachableRate >= 0.01)
    blockers.push("capability_unreachable_rate_not_below_1_percent");
  if (input.loopPairs.length < 30)
    blockers.push("tool_loop_pair_sample_below_30");
  if (summary.repeatedCallReduction < 0.2)
    blockers.push("repeated_call_reduction_below_20_percent");
  if (summary.noNewInformationReduction < 0.2)
    blockers.push("no_new_information_reduction_below_20_percent");
  if (
    input.loopPairs.some(
      ({ candidateRunEvidenceSha256 }) =>
        input.ledgerRuns.find(
          (run) => run.contentSha256 === candidateRunEvidenceSha256,
        )?.status !== "completed",
    )
  )
    blockers.push("tool_loop_candidate_incomplete");
  if (input.codeBridgeCalls.length < 100)
    blockers.push("code_bridge_sample_below_100");
  if (summary.codeBridgeGovernanceCoverage !== 1)
    blockers.push("code_bridge_governance_incomplete");
  if (summary.privilegeExpansionCount !== 0)
    blockers.push("code_bridge_privilege_expansion");
  if (
    new Set(input.codeBridgePrivilegeProbes.map((item) => item.probeClass))
      .size < 3
  )
    blockers.push("code_bridge_privilege_probe_insufficient");
  return blockers;
}

function subagentBlockers(
  input: AgentHarnessAcceptanceEvidenceContent,
  summary: AgentHarnessAcceptanceSummary,
): string[] {
  const blockers: string[] = [];
  if (input.subagentTasks.length < 30)
    blockers.push("subagent_terminal_sample_below_30");
  if (summary.subagentDurableTerminalRate !== 1)
    blockers.push("subagent_durable_terminal_incomplete");
  if (
    input.steeringBoundaryChecks.length < 1 ||
    summary.steeringBoundarySuccessRate !== 1
  )
    blockers.push("subagent_steering_boundary_incomplete");
  if (
    input.cancellationBoundaryChecks.length < 1 ||
    summary.cancellationBoundarySuccessRate !== 1
  )
    blockers.push("subagent_cancellation_boundary_incomplete");
  return blockers;
}

function tokenBlockers(
  input: AgentHarnessAcceptanceEvidenceContent,
  summary: AgentHarnessAcceptanceSummary,
): string[] {
  const blockers: string[] = [];
  if (input.primaryModels.length === 0)
    blockers.push("primary_model_set_empty");
  for (const item of summary.tokenModelP95) {
    if (item.sampleCount < 20)
      blockers.push(`token_sample_below_20:${item.provider}/${item.id}`);
    if (item.p95UnderestimateRatio >= 0.1)
      blockers.push(
        `token_p95_underestimate_not_below_10_percent:${item.provider}/${item.id}`,
      );
  }
  if (!summary.conservativeTokenFallbackVerified)
    blockers.push("conservative_token_fallback_unverified");
  return blockers;
}
