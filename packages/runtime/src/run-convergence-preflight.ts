import type { RunConvergencePolicy } from "./run-convergence-policy.js";
import {
  advancesRunDelivery,
  invocationRunProgress,
} from "./run-convergence-tool-progress.js";
import { opaqueAdmissionsInCurrentClosure } from "./run-convergence-controller-support.js";
import {
  guardRunFailureCircuit,
  projectRunFailureCircuits,
} from "./run-failure-circuit-projection.js";
import type { RunEventQueryPort } from "./run-event-query-port.js";
import type { RunDirectiveState } from "./run-progress-directive-types.js";
import type { ToolProtocolRegistry } from "./tool-protocol-registry.js";

export async function preflightRunTool(input: {
  store: Pick<RunEventQueryPort, "listRunEvents">;
  runId: string;
  registry: ToolProtocolRegistry;
  state: RunDirectiveState;
  policy: Readonly<RunConvergencePolicy>;
  toolName: string;
  args: unknown;
}): Promise<{ block: true; reason: string } | undefined> {
  const progress = invocationRunProgress(
    input.registry,
    input.toolName,
    input.args,
  );
  if (!progress) return undefined;
  let runEvents;
  if (
    progress.coverage === "opaque" &&
    input.state.convergence.phase !== "open"
  ) {
    runEvents = await input.store.listRunEvents(input.runId);
    if (
      opaqueAdmissionsInCurrentClosure(runEvents) >=
      input.policy.unclassifiedActivityLeaseTurns
    ) {
      return {
        block: true,
        reason:
          "This tool has no trusted progress classification and its bounded convergence lease is exhausted. Use a declared retained-evidence or delivery tool.",
      };
    }
  }
  const circuit =
    progress.operation === "acquire"
      ? guardRunFailureCircuit(
          projectRunFailureCircuits(
            runEvents ?? (await input.store.listRunEvents(input.runId)),
            input.runId,
            {
              policy: {
                thresholds: {
                  target: input.policy.resourceCircuitFailures,
                  origin: input.policy.failureDomainCircuitFailures,
                },
              },
            },
          ),
          progress,
          Date.now(),
        )
      : undefined;
  if (circuit?.blocks) {
    return {
      block: true,
      reason: `This acquisition failure domain is open (${circuit.scope}). Choose retained evidence or a different route${circuit.retryAfterMs !== undefined ? `; retry is eligible in ${String(circuit.retryAfterMs)} ms` : ""}.`,
    };
  }
  if (
    !advancesRunDelivery(progress.contribution) &&
    progress.operation === "acquire" &&
    input.state.convergence.phase !== "open"
  ) {
    return {
      block: true,
      reason:
        "Acquisition is closed at the Run convergence checkpoint. Reuse retained evidence and deliver the result.",
    };
  }
  return undefined;
}
