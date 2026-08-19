import { Camera, Download } from "lucide-react";
import { useCallback, useState } from "react";

import type {
  BrowserTakeoverSnapshot,
  ExecuteBrowserTakeoverActionRequest,
} from "@napier/contracts/browser-takeover";
import type { BrowserLiveViewReceipt } from "@napier/contracts/browser-live-view";

import { browserTakeoverLiveMatchesSnapshot } from "./browser-takeover-visual";
import { browserLiveCopy } from "./browser-live-copy";
import type {
  BrowserTakeoverBinding,
  BrowserTakeoverExecute,
} from "./browser-takeover-view";

interface SavedBrowserOutput {
  action: "download" | "save_screenshot";
  path: string;
  fileSha256: string;
  fileBytes: number;
}

export interface BrowserTakeoverOutputProps {
  binding: BrowserTakeoverBinding | undefined;
  snapshot: BrowserTakeoverSnapshot | undefined;
  liveReceipt: BrowserLiveViewReceipt;
  targetRef: string;
  allowCrossOrigin: boolean;
  busy: boolean;
  execute: BrowserTakeoverExecute;
}

export function BrowserTakeoverOutput({
  binding,
  snapshot,
  liveReceipt,
  targetRef,
  allowCrossOrigin,
  busy,
  execute,
}: BrowserTakeoverOutputProps) {
  const [outputPath, setOutputPath] = useState("");
  const [savedOutput, setSavedOutput] = useState<SavedBrowserOutput>();
  const copy = browserLiveCopy.takeover.output;

  const runOutput = useCallback(
    async (request: ExecuteBrowserTakeoverActionRequest) => {
      setSavedOutput(undefined);
      const completed = await execute(request);
      if (
        completed &&
        (request.action === "download" ||
          request.action === "save_screenshot") &&
        completed.outputFileSha256 &&
        completed.outputFileBytes !== undefined
      ) {
        setSavedOutput({
          action: request.action,
          path: request.path,
          fileSha256: completed.outputFileSha256,
          fileBytes: completed.outputFileBytes,
        });
        setOutputPath("");
      }
    },
    [execute],
  );

  const saveScreenshot = useCallback(() => {
    const path = outputPath.trim();
    if (!binding || !path.toLowerCase().endsWith(".png")) return;
    void runOutput({
      ...binding,
      action: "save_screenshot",
      path,
      expectedLiveImageSha256: liveReceipt.imageSha256,
      expectedViewportWidth: liveReceipt.viewportWidth,
      expectedViewportHeight: liveReceipt.viewportHeight,
    });
  }, [binding, liveReceipt, outputPath, runOutput]);

  const downloadRef = useCallback(() => {
    const path = outputPath.trim();
    const ref = targetRef.trim().toLowerCase();
    if (!binding || !path || !ref) return;
    void runOutput({
      ...binding,
      action: "download",
      ref,
      path,
      ...(allowCrossOrigin ? { allowCrossOrigin: true } : {}),
    });
  }, [allowCrossOrigin, binding, outputPath, runOutput, targetRef]);

  return (
    <div className="browser-takeover-output">
      <label>
        {copy.path}
        <input
          value={outputPath}
          onChange={(event) => setOutputPath(event.target.value)}
          placeholder="artifacts/browser-output.png"
          maxLength={500}
          autoComplete="off"
        />
      </label>
      <div>
        <button
          type="button"
          disabled={
            busy ||
            !binding ||
            !outputPath.trim().toLowerCase().endsWith(".png") ||
            !snapshot ||
            !browserTakeoverLiveMatchesSnapshot(liveReceipt, snapshot)
          }
          onClick={saveScreenshot}
        >
          <Camera size={12} aria-hidden="true" />
          {copy.saveScreenshot}
        </button>
        <button
          type="button"
          disabled={busy || !binding || !targetRef.trim() || !outputPath.trim()}
          onClick={downloadRef}
        >
          <Download size={12} aria-hidden="true" />
          {copy.downloadRef}
        </button>
      </div>
      <span>{copy.constraints}</span>
      {savedOutput ? (
        <p role="status">
          {savedOutput.action === "save_screenshot"
            ? copy.screenshotSaved
            : copy.downloadSaved}{" "}
          <code>{savedOutput.path}</code> ·{" "}
          {savedOutput.fileSha256.slice(0, 12)} ·{" "}
          {savedOutput.fileBytes.toLocaleString()} {copy.bytes}
        </p>
      ) : null}
    </div>
  );
}
