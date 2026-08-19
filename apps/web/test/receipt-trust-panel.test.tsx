import type { ReceiptTrustAnchor } from "@napier/contracts";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/receipt-trust-api", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/receipt-trust-api")>();
  const pending = () => new Promise<never>(() => undefined);
  return {
    ...actual,
    listReceiptTrustAnchorDirectorySubscriptions: pending,
    listReceiptTrustAnchorDirectoryQuorumPromotionBaselines: pending,
    getReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory: pending,
    getReceiptTrustAnchorDirectoryQuorumActivationSelectionState: pending,
    getReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit: pending,
    getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint:
      pending,
    listReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions:
      pending,
    listReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselines:
      pending,
  };
});

import { copy } from "../src/copy";
import ReceiptTrustPanel from "../src/ReceiptTrustPanel";
import { projectReceiptTrustController } from "../src/receipt-trust-controller-projection";
import { initialReceiptTrustControllerState } from "../src/receipt-trust-controller-types";
import { clearExternalDirectoryState } from "../src/receipt-trust-state-actions";
import { renderToStaticMarkup } from "./render-static-preact";

describe("ReceiptTrustPanel", () => {
  it("renders the trust workflow as bounded task desks", () => {
    const html = renderToStaticMarkup(
      <ReceiptTrustPanel
        threadId="thread_12345678"
        anchors={[]}
        selectedAnchorId=""
        onSelect={vi.fn()}
        onAnchors={vi.fn()}
      />,
    );

    expect(html).toContain(copy.lab.trust.title);
    expect(html).toContain(copy.lab.trust.anchors);
    expect(html).toContain(copy.lab.trust.verifier);
    expect(html).toContain(copy.lab.trust.directorySubscriptions);
    expect(html).toContain(copy.lab.trust.baselineWorkbench);
    expect(html).toContain(copy.lab.trust.activationSelectionCheckpoint);
    expect(html).toContain(copy.lab.trust.safety);
    expect(html).toContain('aria-busy="false"');
  });

  it("keeps verify-only anchors usable for checkpoint pinning", () => {
    const anchor = verifyOnlyAnchor();
    const state = {
      ...initialReceiptTrustControllerState,
      label: "Release",
      environmentVariable: "NAPIER_RELEASE_KEY",
      checkpointSourceUrl: "https://trust.example.com/checkpoint.json",
      checkpointSubscriptions: [{} as never],
    };
    const props = {
      threadId: "thread_12345678",
      anchors: [anchor],
      selectedAnchorId: anchor.id,
      onSelect: vi.fn(),
      onAnchors: vi.fn(),
    };

    const projection = projectReceiptTrustController(props, state, undefined);

    expect(projection.canCreate).toBe(true);
    expect(
      projection.checkpointDiscoveryRequest?.policy.requiredSignerKeyIds,
    ).toEqual([anchor.keyId]);
    expect(projection.canPromoteCheckpointRegistryQuorum).toBe(false);
  });

  it("clears every external-directory verification projection together", () => {
    const cleared = clearExternalDirectoryState({
      ...initialReceiptTrustControllerState,
      externalDirectory: {} as never,
      externalDirectoryPolicy: {} as never,
      externalDirectorySubscriptionId: "subscription_1",
      directoryDiscovery: {} as never,
      directoryVerification: {} as never,
      directoryMetadataVerification: {} as never,
      verification: {} as never,
    });

    expect(cleared).toMatchObject({
      externalDirectory: undefined,
      externalDirectoryPolicy: undefined,
      externalDirectorySubscriptionId: undefined,
      directoryDiscovery: undefined,
      directoryVerification: undefined,
      directoryMetadataVerification: undefined,
      verification: undefined,
    });
  });
});

function verifyOnlyAnchor(): ReceiptTrustAnchor {
  return {
    id: "anchor_1",
    label: "Release verifier",
    keyId: "a".repeat(64),
    publicKeySpki: "public-key",
    source: { type: "public_key" },
    status: "trusted",
    revision: 1,
    createdAt: "2026-08-19T00:00:00.000Z",
    updatedAt: "2026-08-19T00:00:00.000Z",
  } as ReceiptTrustAnchor;
}
