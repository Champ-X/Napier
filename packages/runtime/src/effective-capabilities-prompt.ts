import type { ToolPolicyMode } from "@napier/contracts";

export function formatEffectiveCapabilitiesPrompt(input: {
  requestedTools: readonly string[];
  activeTools: readonly string[];
  toolPolicy: ToolPolicyMode;
  sandboxId: string;
  restrictedReadOnlyExecution: boolean;
  advisorCorrection: boolean;
  browserInteractionConfirmationAvailable: boolean;
}): string {
  const activeTools = sortedUnique(input.activeTools);
  const activeToolSet = new Set(activeTools);
  const omittedTools = sortedUnique(input.requestedTools).filter(
    (tool) => !activeToolSet.has(tool),
  );
  const browserActive = activeToolSet.has("browser");
  const browserReadOnly =
    input.toolPolicy === "observe" ||
    input.restrictedReadOnlyExecution ||
    input.advisorCorrection ||
    !input.browserInteractionConfirmationAvailable;
  const executionMode = input.restrictedReadOnlyExecution
    ? "restricted_read_only"
    : input.advisorCorrection
      ? "advisor_correction_read_only"
      : "standard";
  return [
    "<effective_capabilities>",
    `Tool policy: ${input.toolPolicy}. Execution mode: ${executionMode}. Sandbox: ${input.sandboxId}.`,
    `Active tools (${activeTools.length}): ${activeTools.join(", ") || "none"}.`,
    `Requested tools omitted or unavailable (${omittedTools.length}): ${omittedTools.join(", ") || "none"}.`,
    browserActive
      ? `Browser backend: native_playwright. Browser interaction: ${browserReadOnly ? "read_only" : "confirmation_governed"}.`
      : "Browser backend: unavailable for this request. Browser interaction: unavailable.",
    "These capabilities are authoritative for this request. Do not claim or silently substitute unavailable tools, isolation, Browser backends, permissions, or fallbacks.",
    "</effective_capabilities>",
  ].join("\n");
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
