import { describe, expect, it } from "vitest";

import { canonicalJson, sha256 } from "../src/ed25519.js";
import { createEnvironmentCapabilityNegotiationReceipt } from "../src/environment-capability-negotiation.js";

describe("Environment capability negotiation receipt", () => {
  it("binds the exact active and omitted tool surface without raw probe detail", () => {
    const receipt = createEnvironmentCapabilityNegotiationReceipt({
      configuredProfile: {
        enabledTools: ["read_file", "web_search", "apply_patch", "run_command"],
      },
      activeProfile: { enabledTools: ["read_file", "web_search"] },
      sandboxId: "unsupported",
      readiness: {
        id: "sandbox:unsupported",
        status: "unavailable",
        configured: true,
        allowedByPolicy: false,
        exposed: false,
        detail: "PRIVATE_HOST_PROBE_DETAIL",
      },
    });
    const { contentSha256, ...content } = receipt;

    expect(receipt).toEqual(
      expect.objectContaining({
        activeToolNames: ["read_file", "web_search"],
        omittedToolNames: ["apply_patch", "run_command"],
        repairCommand:
          "napier setup --workspace 'WORKSPACE_PATH' --component sandbox",
      }),
    );
    expect(contentSha256).toBe(sha256(canonicalJson(content)));
    expect(JSON.stringify(receipt)).not.toContain("PRIVATE_HOST_PROBE_DETAIL");
  });

  it("routes an invalid persisted binding through exact uninstall", () => {
    const receipt = createEnvironmentCapabilityNegotiationReceipt({
      configuredProfile: { enabledTools: ["run_command"] },
      activeProfile: { enabledTools: [] },
      sandboxId: "configured-sandbox-invalid",
      readiness: {
        id: "sandbox:configured-sandbox-invalid",
        status: "unavailable",
        configured: true,
        allowedByPolicy: false,
        exposed: false,
        detail: "invalid binding",
      },
    });

    expect(receipt.repairCommand).toContain("--component sandbox --uninstall");
  });
});
