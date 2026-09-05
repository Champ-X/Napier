/** Stable facade for the replayable failure-circuit read model. */
export {
  DEFAULT_RUN_FAILURE_CIRCUIT_POLICY,
  type ResolvedRunFailureCircuit,
  type RunFailureCircuitEntry,
  type RunFailureCircuitPolicy,
  type RunFailureCircuitProjection,
  type RunFailureCircuitProjectionOptions,
  type RunFailureCircuitScope,
  type RunFailureCircuitStatus,
} from "./run-failure-circuit-model.js";
export { projectRunFailureCircuits } from "./run-failure-circuit-reducer.js";
export {
  failureCircuitKey,
  guardRunFailureCircuit,
  matchRunFailureCircuits,
  resolveRunFailureCircuit,
} from "./run-failure-circuit-resolution.js";
