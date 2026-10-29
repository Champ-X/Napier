// Browser-safe shared projection. Runtime publishes it; compatibility clients
// replay old snapshots through this same contract instead of inferring success.
export * from "./task-narrative-projection.js";
export { taskRunProgress } from "./task-narrative-event-state.js";
export { projectTaskDeliverables } from "./task-deliverables.js";
export { taskArtifactBinding, taskArtifactFacts } from "./task-artifact-facts.js";
export { isSubagentChildRun, latestPrimaryRun } from "./primary-run-selection.js";
