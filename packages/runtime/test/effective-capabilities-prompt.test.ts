import { describe, expect, it } from "vitest";

import { formatEffectiveCapabilitiesPrompt } from "../src/effective-capabilities-prompt.js";

describe("Effective Capabilities Prompt layer", () => {
  it("reports the real policy, sandbox, Browser mode, and deterministic degradation", () => {
    const prompt = formatEffectiveCapabilitiesPrompt({
      requestedTools: ["web_search", "browser", "apply_patch"],
      activeTools: ["browser", "web_search"],
      toolPolicy: "workspace",
      sandboxId: "oci-container",
      restrictedReadOnlyExecution: false,
      advisorCorrection: false,
      browserInteractionConfirmationAvailable: true,
    });

    expect(prompt).toContain(
      "Tool policy: workspace. Execution mode: standard. Sandbox: oci-container.",
    );
    expect(prompt).toContain("Active tools (2): browser, web_search.");
    expect(prompt).toContain(
      "Requested tools omitted or unavailable (1): apply_patch.",
    );
    expect(prompt).toContain(
      "Browser backend: native_playwright. Browser interaction: confirmation_governed.",
    );
    expect(prompt).toContain(
      "Call the Browser action directly; Napier will request exact one-use action-bound confirmation",
    );
    expect(prompt).toContain(
      "do not pre-confirm it with request_operator_decision",
    );
  });

  it("fails capability claims closed for restricted execution", () => {
    const prompt = formatEffectiveCapabilitiesPrompt({
      requestedTools: ["browser"],
      activeTools: ["browser"],
      toolPolicy: "workspace",
      sandboxId: "macos-sandbox-exec",
      restrictedReadOnlyExecution: true,
      advisorCorrection: false,
      browserInteractionConfirmationAvailable: true,
    });

    expect(prompt).toContain("Execution mode: restricted_read_only");
    expect(prompt).toContain("Browser interaction: read_only");
    expect(prompt).toContain("Do not claim or silently substitute");
  });

  it("advertises real write and command tools in full host-direct mode", () => {
    const prompt = formatEffectiveCapabilitiesPrompt({
      requestedTools: ["read_file", "apply_patch", "run_command"],
      activeTools: ["read_file", "apply_patch", "run_command"],
      toolPolicy: "unrestricted",
      sandboxId: "host-direct",
      restrictedReadOnlyExecution: false,
      executionMode: "standard",
      advisorCorrection: false,
      browserInteractionConfirmationAvailable: true,
    });

    expect(prompt).toContain(
      "Tool policy: unrestricted. Execution mode: standard. Sandbox: host-direct.",
    );
    expect(prompt).toContain(
      "Active tools (3): apply_patch, read_file, run_command.",
    );
    expect(prompt).not.toContain(
      "Workspace writes, commands, verification processes",
    );
  });

  it("explains the negotiated environment fallback without exposing withheld tools", () => {
    const prompt = formatEffectiveCapabilitiesPrompt({
      requestedTools: [
        "read_file",
        "web_search",
        "browser",
        "research_source",
        "apply_patch",
        "run_command",
      ],
      activeTools: ["read_file", "web_search", "browser", "research_source"],
      toolPolicy: "workspace",
      sandboxId: "unsupported",
      restrictedReadOnlyExecution: false,
      executionMode: "environment_degraded_read_only",
      advisorCorrection: false,
      browserInteractionConfirmationAvailable: false,
    });

    expect(prompt).toContain("Execution mode: environment_degraded_read_only");
    expect(prompt).toContain(
      "Active tools (4): browser, read_file, research_source, web_search",
    );
    expect(prompt).toContain("apply_patch, run_command");
    expect(prompt).toContain("Browser interaction: read_only");
    expect(prompt).toContain("internal plan controls");
    expect(prompt).toContain("the process Sandbox is unavailable");
    expect(prompt).toContain(
      "Workspace writes, commands, verification processes",
    );
  });
});
