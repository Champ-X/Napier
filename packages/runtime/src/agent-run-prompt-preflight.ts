import type { RunInvocationSource } from "@napier/contracts";

export function validateAgentRunPrompt(
  value: string,
  requestedSource: RunInvocationSource | undefined,
  activeSources: readonly RunInvocationSource[],
): string {
  const prompt = value.trim();
  if (!prompt) throw new Error("Prompt must not be empty");
  if (requestedSource === "workflow_reuse") {
    throw new Error(
      "Workflow reuse Runs can only be created by the Workflow materializer",
    );
  }
  if (requestedSource === "workflow_simulation") {
    throw new Error(
      "Workflow simulation Runs can only be created by an internal Workflow capability",
    );
  }
  if (
    activeSources.length > 0 &&
    (requestedSource !== "workflow" ||
      activeSources.some((source) => source !== "workflow"))
  ) {
    throw new Error("This thread already has an active run");
  }
  return prompt;
}

