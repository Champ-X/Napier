import type { RunEvent } from "@napier/contracts";
import { validatePersistedEvaluationState } from "./store-state-evaluation-validation.js";
import { validatePersistedExtensionState } from "./store-state-extension-validation.js";
import {
  normalizePersistedStoreState,
  validatePersistedWorkspaceState,
} from "./store-state-normalization.js";
import { validatePersistedReceiptTrustState } from "./store-state-receipt-validation.js";
import { validatePersistedRunState } from "./store-state-run-validation.js";
import type { PersistedStoreState } from "./store-state.js";

export function validatePersistedStoreState(
  state: PersistedStoreState,
  statePath: string,
  sourceBindingEvents?: readonly RunEvent[],
): PersistedStoreState {
  const migrateAgentRevisions = normalizePersistedStoreState(state, statePath);
  validatePersistedExtensionState(state);
  validatePersistedWorkspaceState(state, migrateAgentRevisions);
  validatePersistedRunState(state);
  validatePersistedEvaluationState(state, sourceBindingEvents);
  validatePersistedReceiptTrustState(state);
  return state;
}
