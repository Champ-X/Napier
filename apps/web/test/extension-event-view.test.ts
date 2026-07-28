import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  extensionEventTraceSummary,
  extensionEventTraceView,
} from "../src/extension-event-view";

describe("Extension event trace view", () => {
  it("projects extension proposals without names or capability labels", () => {
    const event = extensionEvent("extension.proposed", {
      extensionId: "extension_1234567890",
      name: "TOP_SECRET_EXTENSION_NAME",
      normalizedName: "top_secret_extension_name",
      description: "TOP_SECRET_EXTENSION_DESCRIPTION",
      kind: "mcp",
      requestedCapabilities: ["TOP_SECRET_CAPABILITY", "network.connect"],
      provenanceSha256: "a".repeat(64),
    });

    expect(extensionEventTraceView(event)).toEqual({
      action: "proposed",
      extensionId: "extension_1234567890",
      kind: "mcp",
      requestedCapabilityCount: 2,
      provenanceSha256: "a".repeat(64),
    });
    expect(extensionEventTraceSummary(event)).toBe(
      `extension / proposed / extension 1234567890 / kind mcp / requested-capabilities 2 / provenance ${"a".repeat(12)}`,
    );
    expect(extensionEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("projects review and tool receipts without tool names", () => {
    const approved = extensionEvent("extension.approved", {
      extensionId: "extension_1234567890",
      trustStatus: "approved",
      approvedCapabilities: ["TOP_SECRET_APPROVED_CAPABILITY"],
    });
    const tool = extensionEvent("extension.tool.approved", {
      extensionId: "extension_1234567890",
      toolName: "TOP_SECRET_TOOL_NAME",
      directName: "TOP_SECRET_DIRECT_NAME",
      reviewStatus: "approved",
      effect: "read",
      schemaSha256: "b".repeat(64),
    });

    expect(extensionEventTraceSummary(approved)).toBe(
      "extension / approved / extension 1234567890 / trust approved / approved-capabilities 1",
    );
    expect(extensionEventTraceSummary(tool)).toBe(
      `extension / tool.approved / extension 1234567890 / review approved / effect read / schema ${"b".repeat(12)}`,
    );
    expect(extensionEventTraceSummary(approved)).not.toContain("TOP_SECRET");
    expect(extensionEventTraceSummary(tool)).not.toContain("TOP_SECRET");
  });

  it("projects package updates as counts and hashes", () => {
    const event = extensionEvent("extension.package.updated", {
      extensionId: "extension_1234567890",
      expectedPackageBindingSha256: "c".repeat(64),
      currentManifestSha256: "d".repeat(64),
      currentEnvelopeSha256: "e".repeat(64),
      nextManifestSha256: "f".repeat(64),
      nextEnvelopeSha256: "1".repeat(64),
      previewSha256: "2".repeat(64),
      versionDirection: "upgrade",
      publisherChanged: true,
      changeKinds: ["TOP_SECRET_CHANGE_KIND", "tools.added"],
      packageHistoryCount: 3,
    });

    expect(extensionEventTraceSummary(event)).toBe(
      `extension / package.updated / extension 1234567890 / version upgrade / publisher-changed true / change-kinds 2 / package-history 3 / expected-binding ${"c".repeat(12)} / current-manifest ${"d".repeat(12)} / current-envelope ${"e".repeat(12)} / next-manifest ${"f".repeat(12)} / next-envelope ${"1".repeat(12)} / preview ${"2".repeat(12)}`,
    );
    expect(extensionEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("projects rollout receipts without channel names", () => {
    const published = extensionEvent("extension.packages.rollout.published", {
      channelId: "rollout_channel_1234567890",
      name: "TOP_SECRET_ROLLOUT_NAME",
      normalizedName: "top_secret_rollout_name",
      revision: 3,
      lockfileSha256: "3".repeat(64),
      packageCount: 5,
      dependencyCount: 8,
      packageEnvelopeIdsSha256: "4".repeat(64),
      policySha256: "5".repeat(64),
    });
    const deployed = extensionEvent("extension.packages.deployed", {
      deploymentSha256: "6".repeat(64),
      candidateCount: 7,
      installCount: 2,
      updateCount: 1,
      installedExtensionIdsSha256: "7".repeat(64),
      updatedExtensionIdsSha256: "8".repeat(64),
      candidateEnvelopeIdsSha256: "9".repeat(64),
      applyOrderSha256: "a".repeat(64),
      dependencyResolutionSha256: "b".repeat(64),
      summary: "TOP_SECRET_DEPLOYMENT_SUMMARY",
    });

    expect(extensionEventTraceSummary(published)).toBe(
      `extension / packages.rollout.published / channel 1234567890 / packages 5 / dependencies 8 / revision 3 / lockfile ${"3".repeat(12)} / package-envelopes ${"4".repeat(12)} / policy ${"5".repeat(12)}`,
    );
    expect(extensionEventTraceSummary(deployed)).toBe(
      `extension / packages.deployed / candidates 7 / installed 2 / updated 1 / deployment ${"6".repeat(12)} / installed ${"7".repeat(12)} / updated ${"8".repeat(12)} / candidate-envelopes ${"9".repeat(12)} / apply-order ${"a".repeat(12)} / dependency-resolution ${"b".repeat(12)}`,
    );
    expect(extensionEventTraceSummary(published)).not.toContain("TOP_SECRET");
    expect(extensionEventTraceSummary(deployed)).not.toContain("TOP_SECRET");
  });

  it("fails closed for malformed and unknown extension receipts", () => {
    expect(
      extensionEventTraceSummary(extensionEvent("extension.proposed", [])),
    ).toBe("extension receipt");
    expect(
      extensionEventTraceSummary(
        extensionEvent("extension.future", {
          name: "TOP_SECRET_FUTURE_EXTENSION",
        }),
      ),
    ).toBe("extension");
  });
});

function extensionEvent(type: string, payload: RunEvent["payload"]): RunEvent {
  return {
    id: `event_${type.replaceAll(".", "_")}`,
    threadId: "thread_extension",
    runId: "run_extension",
    seq: 47,
    type,
    category: "extension",
    visibility: "user",
    payload,
    createdAt: "2026-07-28T12:00:00.000Z",
  };
}
