import { Eye, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { BrowserLiveViewReceipt } from "@napier/contracts/browser-live-view";

import { getBrowserLiveView } from "./browser-live-view-api";

const REFRESH_MS = 1_500;

export function BrowserLiveViewPanel({
  threadId,
  runId,
}: {
  threadId: string;
  runId: string;
}) {
  const [imageUrl, setImageUrl] = useState<string>();
  const [receipt, setReceipt] = useState<BrowserLiveViewReceipt>();
  const [available, setAvailable] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const requestRef = useRef(0);
  const imageUrlRef = useRef<string | undefined>(undefined);
  const controllerRef = useRef<AbortController | undefined>(undefined);

  const refresh = useCallback(async () => {
    const request = (requestRef.current += 1);
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setRefreshing(true);
    try {
      const live = await getBrowserLiveView(threadId, runId, controller.signal);
      if (request !== requestRef.current) return;
      const nextUrl = URL.createObjectURL(live.blob);
      if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
      imageUrlRef.current = nextUrl;
      setImageUrl(nextUrl);
      setReceipt(live.receipt);
      setAvailable(true);
    } catch {
      if (request !== requestRef.current) return;
      if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
      imageUrlRef.current = undefined;
      setImageUrl(undefined);
      setReceipt(undefined);
      setAvailable(false);
    } finally {
      if (request === requestRef.current) {
        controllerRef.current = undefined;
        setRefreshing(false);
      }
    }
  }, [runId, threadId]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      window.clearInterval(timer);
      requestRef.current += 1;
      controllerRef.current?.abort();
      controllerRef.current = undefined;
      if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
      imageUrlRef.current = undefined;
    };
  }, [refresh]);

  if (!available || !imageUrl || !receipt) return null;
  return (
    <section className="browser-live-view" aria-label="Browser Live">
      <header>
        <span>
          <Eye size={13} aria-hidden="true" />
          Browser Live
        </span>
        <button
          type="button"
          disabled={refreshing}
          onClick={() => void refresh()}
        >
          <RefreshCw size={12} aria-hidden="true" />
          Refresh
        </button>
      </header>
      <img
        src={imageUrl}
        alt="Live viewport from the active isolated Browser Session"
      />
      <footer>
        <span>op {String(receipt.sessionOperation)}</span>
        <span title={receipt.currentOriginSha256}>
          origin {receipt.currentOriginSha256.slice(0, 10)}
        </span>
        <span>{new Date(receipt.capturedAt).toLocaleTimeString()}</span>
      </footer>
    </section>
  );
}
