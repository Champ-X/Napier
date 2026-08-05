import type { BrowserLiveViewReceipt } from "@napier/contracts/browser-live-view";

import { throwNapierApiError } from "./api-error";
import {
  receiptFromHeaders,
  verifyBrowserLiveView,
} from "./browser-live-view-verification";

export interface BrowserLiveView {
  blob: Blob;
  receipt: BrowserLiveViewReceipt;
}

export async function getBrowserLiveView(
  threadId: string,
  runId: string,
  signal?: AbortSignal,
): Promise<BrowserLiveView> {
  const path = `/api/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}/browser-live-view`;
  const response = await fetch(path, {
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    await throwNapierApiError(response, "Browser live view unavailable", path);
  }
  const bytes = await response.arrayBuffer();
  const receipt = receiptFromHeaders(response, bytes.byteLength);
  await verifyBrowserLiveView({ path, threadId, runId, bytes, receipt });
  return {
    blob: new Blob([bytes], { type: receipt.mimeType }),
    receipt,
  };
}
