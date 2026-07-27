import type {
  CreateReceiptTrustAnchorRequest,
  EvaluationQualificationBaseline,
  PromoteEvaluationQualificationBaselineResult,
  ReceiptTrustAnchor,
  ReceiptTrustAnchorDirectory,
  ReceiptTrustAnchorDirectoryVerification,
  ReceiptTrustAnchorDirectoryVerificationPolicy,
  TrustedReceiptEnvelope,
  TrustedReceiptVerification,
  VerifyReceiptTrustAnchorDirectoryRequest,
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
