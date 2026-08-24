import type {
  EvaluationQualificationBaseline,
  PromoteEvaluationQualificationBaselineResult,
  ReceiptTrustAnchorDirectoryVerificationPolicy,
  TrustedReceiptEnvelope,
  TrustedReceiptVerification,
} from "@napier/contracts";

import { requestJson as requestTrustJson } from "./api-client";

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
