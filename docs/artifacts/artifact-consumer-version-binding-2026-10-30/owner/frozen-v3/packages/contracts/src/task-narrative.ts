// Browser-safe shared projection. Runtime publishes it; compatibility clients
// replay old snapshots through this same contract instead of inferring success.
export * from "./task-narrative-projection.js";
export { taskRunProgress } from "./task-narrative-event-state.js";
export { projectTaskDeliverables } from "./task-deliverables.js";
export {
  taskArtifactBinding,
  taskArtifactCurrentFact,
  taskArtifactFacts,
} from "./task-artifact-facts.js";
export {
  taskArtifactReceiptMatches,
  type TaskArtifactSelection,
  type TaskArtifactReceipt,
  type TaskArtifactReceiptMode,
} from "./task-artifact-receipt.js";
export {
  isSubagentChildRun,
  latestPrimaryRun,
} from "./primary-run-selection.js";
export {
  createConversationArtifactEventState,
  applyConversationArtifactEvent,
  projectConversationArtifacts,
  conversationArtifactEventKey,
  type ConversationArtifactEventState,
  type ConversationArtifact,
} from "./conversation-artifact-projection.js";
