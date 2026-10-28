import { useBrowserInteractionConfirmation } from "./use-browser-interaction-confirmation";
import { useOperatorDecisionActions } from "./use-operator-decision-actions";

/** The two decision dockets share a workspace/thread view, but keep their
 * distinct authorization and continuation protocols. */
export function useThreadDecisionActions(
  input: Parameters<typeof useOperatorDecisionActions>[0] & {
    setError(message: string | undefined): void;
  },
) {
  return {
    ...useOperatorDecisionActions(input),
    ...useBrowserInteractionConfirmation(input.detail, input.setError),
  };
}
