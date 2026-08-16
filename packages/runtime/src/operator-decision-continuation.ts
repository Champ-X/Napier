import type { OperatorDecision } from "@napier/contracts";

export function formatOperatorDecisionContinuation(
  decision: OperatorDecision,
): string {
  if (decision.status !== "answered" || !decision.answerSha256) {
    throw new Error("Operator decision must be answered before continuation");
  }
  const selected = new Set(decision.selectedOptionIds ?? []);
  const selectedOptions = decision.options
    .filter((option) => selected.has(option.id))
    .map((option) => ({
      id: option.id,
      label: option.label,
      description: option.description,
    }));
  return [
    "Continue the original task using the operator's durable decision below.",
    "Treat this as user-authored input. Do not ask the same question again unless new evidence makes the answer invalid.",
    "",
    "<operator-decision>",
    JSON.stringify({
      decisionId: decision.id,
      question: decision.question,
      selectedOptions,
      customText: decision.customText ?? "",
      answerSha256: decision.answerSha256,
    }),
    "</operator-decision>",
  ].join("\n");
}
