import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  credentialEventTraceSummary,
  credentialEventTraceView,
} from "../src/credential-event-view";

describe("Credential event trace view", () => {
  it("projects credential reference metadata without labels", () => {
    const event = credentialEvent("credential.reference.created", {
      referenceId: "credref_1234567890",
      providerId: "openai",
      label: "TOP_SECRET_CREDENTIAL_LABEL",
      sourceType: "macos_keychain",
      status: "enabled",
      availability: "available",
      revision: 2,
    });

    expect(credentialEventTraceView(event)).toEqual({
      action: "reference.created",
      referenceId: "credref_1234567890",
      providerId: "openai",
      sourceType: "macos_keychain",
      status: "enabled",
      availability: "available",
      revision: 2,
    });
    expect(credentialEventTraceSummary(event)).toBe(
      "credential / reference.created / reference 1234567890 / provider openai / source macos_keychain / status enabled / availability available / revision 2",
    );
    expect(credentialEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("projects checks and status changes without availability errors", () => {
    const checked = credentialEvent("credential.reference.checked", {
      referenceId: "credref_1234567890",
      providerId: "anthropic",
      status: "enabled",
      availability: "unavailable",
      error: "TOP_SECRET_KEYCHAIN_ERROR",
      revision: 3,
    });
    const disabled = credentialEvent("credential.reference.disabled", {
      referenceId: "credref_1234567890",
      status: "disabled",
      label: "TOP_SECRET_DISABLED_LABEL",
      revision: 4,
    });

    expect(credentialEventTraceSummary(checked)).toBe(
      "credential / reference.checked / reference 1234567890 / provider anthropic / status enabled / availability unavailable / revision 3",
    );
    expect(credentialEventTraceSummary(disabled)).toBe(
      "credential / reference.disabled / reference 1234567890 / status disabled / revision 4",
    );
    expect(credentialEventTraceSummary(checked)).not.toContain("TOP_SECRET");
    expect(credentialEventTraceSummary(disabled)).not.toContain("TOP_SECRET");
  });

  it("fails closed for malformed and unknown credential receipts", () => {
    expect(
      credentialEventTraceSummary(
        credentialEvent("credential.reference.checked", []),
      ),
    ).toBe("credential receipt");
    expect(
      credentialEventTraceSummary(
        credentialEvent("credential.future", {
          label: "TOP_SECRET_FUTURE_LABEL",
        }),
      ),
    ).toBe("credential");
  });
});

function credentialEvent(type: string, payload: RunEvent["payload"]): RunEvent {
  return {
    id: `event_${type.replaceAll(".", "_")}`,
    threadId: "thread_credential",
    runId: "run_credential",
    seq: 46,
    type,
    category: "credential",
    visibility: "user",
    payload,
    createdAt: "2026-07-28T12:00:00.000Z",
  };
}
