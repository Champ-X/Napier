import type {
  CreateReceiptTrustAnchorRequest,
  CreateReceiptTrustAnchorDirectorySubscriptionRequest,
  DiscoverReceiptTrustAnchorDirectoryRequest,
  EvaluateReceiptTrustAnchorDirectoryQuorumRequest,
  EvaluationQualificationBaseline,
  PromoteEvaluationQualificationBaselineResult,
  PromoteReceiptTrustAnchorDirectoryQuorumRequest,
  ReceiptTrustAnchor,
  ReceiptTrustAnchorDirectory,
  ReceiptTrustAnchorDirectoryDiscovery,
  ReceiptTrustAnchorDirectoryMetadataVerification,
  ReceiptTrustAnchorDirectoryQuorum,
  ReceiptTrustAnchorDirectoryQuorumPromotionReceipt,
  ReceiptTrustAnchorDirectorySubscription,
  ReceiptTrustAnchorDirectorySubscriptionRefreshResult,
  ReceiptTrustAnchorDirectoryVerification,
  ReceiptTrustAnchorDirectoryVerificationPolicy,
  SignReceiptTrustAnchorDirectoryMetadataRequest,
  TrustedReceiptEnvelope,
  TrustedReceiptVerification,
  VerifyReceiptTrustAnchorDirectoryMetadataRequest,
  VerifyReceiptTrustAnchorDirectoryRequest,
  UpdateReceiptTrustAnchorDirectorySubscriptionRequest,
} from "@napier/contracts";

import { requestJson as requestTrustJson } from "./api-client";

export function listReceiptTrustAnchors(): Promise<ReceiptTrustAnchor[]> {
  return requestTrustJson("/api/receipt-trust/anchors");
}

export function getReceiptTrustAnchorDirectory(): Promise<ReceiptTrustAnchorDirectory> {
  return requestTrustJson("/api/receipt-trust/anchors/directory");
}

export function verifyReceiptTrustAnchorDirectory(
  body: VerifyReceiptTrustAnchorDirectoryRequest,
): Promise<ReceiptTrustAnchorDirectoryVerification> {
  return requestTrustJson("/api/receipt-trust/anchors/directory/verify", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getSignedReceiptTrustAnchorDirectoryMetadata(
  body: SignReceiptTrustAnchorDirectoryMetadataRequest,
): Promise<TrustedReceiptEnvelope> {
  return requestTrustJson(
    "/api/receipt-trust/anchors/directory/signed-metadata",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function verifyReceiptTrustAnchorDirectoryMetadata(
  body: VerifyReceiptTrustAnchorDirectoryMetadataRequest,
): Promise<ReceiptTrustAnchorDirectoryMetadataVerification> {
  return requestTrustJson(
    "/api/receipt-trust/anchors/directory/metadata/verify",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function discoverReceiptTrustAnchorDirectory(
  body: DiscoverReceiptTrustAnchorDirectoryRequest,
): Promise<ReceiptTrustAnchorDirectoryDiscovery> {
  return requestTrustJson("/api/receipt-trust/anchors/directory/discover", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function listReceiptTrustAnchorDirectorySubscriptions(): Promise<
  ReceiptTrustAnchorDirectorySubscription[]
> {
  return requestTrustJson("/api/receipt-trust/anchors/directory/subscriptions");
}

export function evaluateReceiptTrustAnchorDirectoryQuorum(
  body: EvaluateReceiptTrustAnchorDirectoryQuorumRequest = {},
): Promise<ReceiptTrustAnchorDirectoryQuorum> {
  return requestTrustJson(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function promoteReceiptTrustAnchorDirectoryQuorum(
  body: PromoteReceiptTrustAnchorDirectoryQuorumRequest = {},
): Promise<ReceiptTrustAnchorDirectoryQuorumPromotionReceipt> {
  return requestTrustJson(
    "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function createReceiptTrustAnchorDirectorySubscription(
  body: CreateReceiptTrustAnchorDirectorySubscriptionRequest,
): Promise<ReceiptTrustAnchorDirectorySubscription> {
  return requestTrustJson(
    "/api/receipt-trust/anchors/directory/subscriptions",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function refreshReceiptTrustAnchorDirectorySubscription(
  subscriptionId: string,
  threadId: string,
  expectedRevision: number,
): Promise<ReceiptTrustAnchorDirectorySubscriptionRefreshResult> {
  return requestTrustJson(
    `/api/receipt-trust/anchors/directory/subscriptions/${encodeURIComponent(subscriptionId)}/refresh`,
    {
      method: "POST",
      body: JSON.stringify({ threadId, expectedRevision }),
    },
  );
}

export function updateReceiptTrustAnchorDirectorySubscription(
  subscriptionId: string,
  body: UpdateReceiptTrustAnchorDirectorySubscriptionRequest,
): Promise<ReceiptTrustAnchorDirectorySubscription> {
  return requestTrustJson(
    `/api/receipt-trust/anchors/directory/subscriptions/${encodeURIComponent(subscriptionId)}`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function createReceiptTrustAnchor(
  body: CreateReceiptTrustAnchorRequest,
): Promise<ReceiptTrustAnchor> {
  return requestTrustJson("/api/receipt-trust/anchors", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function revokeReceiptTrustAnchor(
  anchorId: string,
  threadId: string,
): Promise<ReceiptTrustAnchor> {
  return requestTrustJson(
    `/api/receipt-trust/anchors/${encodeURIComponent(anchorId)}/revoke`,
    {
      method: "POST",
      body: JSON.stringify({ threadId }),
    },
  );
}

export function verifyTrustedReceipt(
  envelope: unknown,
  directory?: unknown,
  directoryPolicy?: ReceiptTrustAnchorDirectoryVerificationPolicy,
): Promise<TrustedReceiptVerification> {
  return requestTrustJson("/api/receipt-trust/verify", {
    method: "POST",
    body: JSON.stringify({
      envelope,
      ...(directory !== undefined ? { directory } : {}),
      ...(directoryPolicy !== undefined ? { directoryPolicy } : {}),
    }),
  });
}

export function getSignedEvaluationSuiteReceipt(
  threadId: string,
  suiteId: string,
  trustAnchorId: string,
): Promise<TrustedReceiptEnvelope> {
  return requestTrustJson(
    `/api/threads/${encodeURIComponent(threadId)}/evaluation-suites/${encodeURIComponent(suiteId)}/signed-receipt`,
    {
      method: "POST",
      body: JSON.stringify({ trustAnchorId }),
    },
  );
}

export function getSignedCasebookQualificationReceipt(
  casebookId: string,
  threadId: string,
  trustAnchorId: string,
): Promise<TrustedReceiptEnvelope> {
  return requestTrustJson(
    `/api/evaluation-casebooks/${encodeURIComponent(casebookId)}/signed-qualification-receipt`,
    {
      method: "POST",
      body: JSON.stringify({ threadId, trustAnchorId }),
    },
  );
}

export function listEvaluationQualificationBaselines(
  casebookId: string,
): Promise<EvaluationQualificationBaseline[]> {
  return requestTrustJson(
    `/api/evaluation-casebooks/${encodeURIComponent(casebookId)}/qualification-baselines`,
  );
}

export function promoteEvaluationQualificationBaseline(
  casebookId: string,
  threadId: string,
  trustAnchorId: string,
): Promise<PromoteEvaluationQualificationBaselineResult> {
  return requestTrustJson(
    `/api/evaluation-casebooks/${encodeURIComponent(casebookId)}/qualification-baselines`,
    {
      method: "POST",
      body: JSON.stringify({ threadId, trustAnchorId }),
    },
  );
}
