import type { SelectedModelAvailability } from "./model-selection-view-model";

export function composerCanStartRun(input: {
  text: string;
  hasThread: boolean;
  hasOpenDecision: boolean;
  hasBrowserConfirmation?: boolean;
  model: SelectedModelAvailability;
}): boolean {
  return Boolean(
    input.text.trim() &&
      input.hasThread &&
      !input.hasOpenDecision &&
      !input.hasBrowserConfirmation &&
      input.model.configured,
  );
}
