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
});
