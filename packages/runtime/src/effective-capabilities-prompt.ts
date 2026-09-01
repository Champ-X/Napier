import type { RunExecutionMode, ToolPolicyMode } from "@napier/contracts";

export function formatEffectiveCapabilitiesPrompt(input: {
  requestedTools: readonly string[];
  availableTools?: readonly string[];
  activeTools: readonly string[];
  toolPolicy: ToolPolicyMode;
  sandboxId: string;
  restrictedReadOnlyExecution: boolean;
  executionMode?: RunExecutionMode;
  advisorCorrection: boolean;
  browserInteractionConfirmationAvailable: boolean;
}): string {
  const activeTools = sortedUnique(input.activeTools);
  const activeToolSet = new Set(activeTools);
  const browserActive = activeToolSet.has("browser");
  const browserReadOnly =
    input.toolPolicy === "observe" ||
    input.restrictedReadOnlyExecution ||
    input.advisorCorrection ||
    !input.browserInteractionConfirmationAvailable;
  const executionMode =
    input.executionMode === "environment_degraded_read_only"
      ? "environment_degraded_read_only"
      : input.restrictedReadOnlyExecution
        ? "restricted_read_only"
        : input.advisorCorrection
          ? "advisor_correction_read_only"
          : "standard";
  const availableTools = sortedUnique(
    input.availableTools ?? input.requestedTools,
  );
  const capabilityDiscoveryAvailable =
    executionMode === "standard" && activeToolSet.has("capability");
  const deferredTools = capabilityDiscoveryAvailable
    ? availableTools.filter((tool) => !activeToolSet.has(tool))
    : [];
  const deferredToolSet = new Set(deferredTools);
  const unavailableTools = sortedUnique(input.requestedTools).filter(
    (tool) => !activeToolSet.has(tool) && !deferredToolSet.has(tool),
  );
  const browserDeferred = deferredToolSet.has("browser");
  const commandSurfaces = new Set([...activeTools, ...deferredTools]);
  return [
    "<effective_capabilities>",
    `Tool policy: ${input.toolPolicy}. Execution mode: ${executionMode}. Sandbox: ${input.sandboxId}.`,
    `Active tools (${activeTools.length}): ${activeTools.join(", ") || "none"}.`,
    ...(capabilityDiscoveryAvailable
      ? [
          `Configured tools currently hidden by the focused model surface (${deferredTools.length}; discoverable via capability): ${deferredTools.join(", ") || "none"}.`,
        ]
      : []),
    `Requested tools unavailable or policy-withheld (${unavailableTools.length}): ${unavailableTools.join(", ") || "none"}.`,
    browserActive
      ? browserReadOnly
        ? "Browser backend: native_playwright. Browser interaction: read_only."
        : "Browser backend: native_playwright. Browser interaction: confirmation_governed. Call the Browser action directly; Napier will request exact one-use action-bound confirmation, so do not pre-confirm it with request_operator_decision."
      : browserDeferred
        ? "Browser backend: configured but hidden on this step. Query capability for browser to activate it on the next step before concluding that Browser is unavailable."
        : "Browser backend: unavailable for this request. Browser interaction: unavailable.",
    ...(commandSurfaces.has("workspace_process")
      ? [
          commandSurfaces.has("run_command")
            ? "Command surfaces: workspace_process with runtime=shell runs one explicit POSIX shell script; run_command accepts Node literal argv and is not a shell."
            : "Command surface: workspace_process with runtime=shell runs one explicit POSIX shell script.",
          "Repository acquisition: workspace_process is not a network grant. Use governed web_search/web_fetch sources to locate and inspect public source; do not infer clone authorization from host-direct isolation warnings.",
        ]
      : commandSurfaces.has("run_command")
        ? [
            "Command surface: run_command accepts Node literal argv and is not a shell.",
          ]
        : []),
    ...(executionMode === "environment_degraded_read_only"
      ? [
          "Environment negotiation: the process Sandbox is unavailable, so this Run continues with independent local reads, configured static network reads, read-only Browser and research sessions when healthy, and internal plan controls. Workspace writes, commands, verification processes, Extensions, and Subagents are unavailable. Inspect first; when mutation or execution is required, explain the boundary once and direct the operator to Sandbox Setup.",
        ]
      : []),
    ...(capabilityDiscoveryAvailable
      ? [
          "A focused model surface hides schemas; it does not revoke configured capability or authorization. Before claiming that a needed tool is unavailable or requesting operator help for a capability blocker, query capability by semantic need if necessary, then call the returned exact cap://tools/<tool> URI to activate one schema and continue on the next step.",
        ]
      : []),
    "These capabilities are authoritative for this request. Preserve the capability-state distinctions above. Do not claim or silently substitute unavailable tools, isolation, Browser backends, permissions, or fallbacks.",
    "</effective_capabilities>",
  ].join("\n");
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
