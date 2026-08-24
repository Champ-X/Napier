import type {
  ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory,
  ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryVerification,
  ReceiptTrustAnchorDirectoryQuorumActivationDecisionRecord,
  ReceiptTrustAnchorDirectoryQuorumActivationSelection,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionState,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointVerification,
} from "@napier/contracts";
import {
  createReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory,
  createReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit,
  createReceiptTrustAnchorDirectoryQuorumActivationSelectionState,
  createReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint,
  validateReceiptTrustAnchorDirectoryQuorumActivationSelection,
  verifyReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory,
  verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint,
} from "./receipt-trust-directory-subscriptions.js";
import type { StoreRepositoryHost } from "./store-repository-host.js";

export class ReceiptTrustActivationReadRepository {
  constructor(protected readonly host: StoreRepositoryHost) {}

  listReceiptTrustAnchorDirectoryQuorumActivationDecisionRecords(): ReceiptTrustAnchorDirectoryQuorumActivationDecisionRecord[] {
    this.host.assertInitialized();
    return structuredClone(
      this.host.state.receiptTrustAnchorDirectoryQuorumActivationDecisions
        .slice()
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    );
  }

  getReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory(): ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory {
    this.host.assertInitialized();
    return createReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory(
      this.listReceiptTrustAnchorDirectoryQuorumActivationDecisionRecords(),
    );
  }

  verifyReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory(
    value: unknown,
  ): ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryVerification {
    this.host.assertInitialized();
    return verifyReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory(
      value,
      this.getReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory(),
    );
  }

  getReceiptTrustAnchorDirectoryQuorumActivationSelectionState(): ReceiptTrustAnchorDirectoryQuorumActivationSelectionState {
    this.host.assertInitialized();
    return createReceiptTrustAnchorDirectoryQuorumActivationSelectionState(
      this.host.state.receiptTrustAnchorDirectoryQuorumActivationSelection,
    );
  }

  getReceiptTrustAnchorDirectoryQuorumActivationSelectionBySha256(
    selectionSha256: string,
  ): ReceiptTrustAnchorDirectoryQuorumActivationSelection | undefined {
    this.host.assertInitialized();
    if (!/^[a-f0-9]{64}$/.test(selectionSha256)) return undefined;
    const selection =
      this.host.state.receiptTrustAnchorDirectoryQuorumActivationSelections.find(
        (candidate) => candidate.contentSha256 === selectionSha256,
      );
    return selection
      ? validateReceiptTrustAnchorDirectoryQuorumActivationSelection(selection)
      : undefined;
  }

  getReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit(): ReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit {
    this.host.assertInitialized();
    return createReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit(
      {
        selectionState:
          this.getReceiptTrustAnchorDirectoryQuorumActivationSelectionState(),
        currentQuorum:
          this.host.getReceiptTrustAnchorDirectorySubscriptionQuorum(),
      },
    );
  }

  getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint(): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint {
    this.host.assertInitialized();
    return createReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint(
      this.host.state.receiptTrustAnchorDirectoryQuorumActivationSelections,
      this.getReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit(),
    );
  }

  verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint(
    value: unknown,
  ): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointVerification {
    this.host.assertInitialized();
    return verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint(
      value,
      this.getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint(),
    );
  }
}
