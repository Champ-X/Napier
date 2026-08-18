import type { SelectedModelAvailability } from "./model-selection-view-model";

export function composerCanStartRun(input: {
  text: string;
  hasThread: boolean;
  hasOpenDecision: boolean;
  model: SelectedModelAvailability;
}): boolean {
  return Boolean(
    input.text.trim() &&
    input.hasThread &&
    !input.hasOpenDecision &&
    input.model.configured,
  );
}
