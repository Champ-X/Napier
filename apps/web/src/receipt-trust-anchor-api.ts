import type {
  CreateReceiptTrustAnchorRequest,
  ReceiptTrustAnchor,
} from "@napier/contracts";

import { requestJson as requestTrustJson } from "./api-client";

export function listReceiptTrustAnchors(): Promise<ReceiptTrustAnchor[]> {
  return requestTrustJson("/api/receipt-trust/anchors");
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
