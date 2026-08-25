import { Eye, Pause, Play, RefreshCw, ShieldAlert } from "lucide-react";
import { lazy, Suspense } from "react";

import type { BrowserLiveViewReceipt } from "@napier/contracts/browser-live-view";
import type { BrowserTakeoverAction } from "@napier/contracts/browser-takeover";

import type { BrowserLiveActivity } from "./browser-live-activity";
import { browserLiveCopy } from "./browser-live-copy";
import { getLocale } from "./locale";
import "./browser-live-view.css";

const LazyBrowserTakeoverDesk = lazy(() =>
  import("./BrowserTakeoverDesk").then(({ BrowserTakeoverDesk }) => ({
    default: BrowserTakeoverDesk,
  })),
);

export interface BrowserLiveViewSurfaceProps {
  threadId: string;
  runId: string;
  imageUrl: string;
  receipt: BrowserLiveViewReceipt;
  paused: boolean;
  takeoverOpen: boolean;
  refreshing: boolean;
  controlBusy: boolean;
  controlFailed: boolean;
  activity: BrowserLiveActivity;
  onTogglePause: () => Promise<void>;
  onOpenTakeover: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onOperatorAction: (action: BrowserTakeoverAction | undefined) => void;
  onReturnToAgent: () => Promise<void>;
}

export function BrowserLiveViewSurface(props: BrowserLiveViewSurfaceProps) {
  const copy = browserLiveCopy.live;
  const diagnosis = props.receipt.pageDiagnosis.status;
  const diagnosisActive = diagnosis !== "none";
  return (
    <section
      className={`browser-live-view${props.paused ? " is-paused" : ""}${props.paused && props.takeoverOpen ? " has-takeover" : ""}${diagnosisActive ? " has-diagnosis" : ""}`}
      aria-label={copy.label}
      tabIndex={-1}
    >
      <header>
        <span>
          <Eye size={13} aria-hidden="true" />
          {copy.label}
        </span>
        <div className="browser-live-controls">
          <span
            className={`browser-session-state ${props.paused ? "is-paused" : ""}`}
            aria-live="polite"
          >
            {props.paused ? copy.paused : copy.running}
          </span>
          <button
            className="browser-session-toggle"
            type="button"
            aria-busy={props.controlBusy}
            disabled={props.controlBusy}
            onClick={() => void props.onTogglePause()}
            title={props.paused ? copy.resumeTitle : copy.pauseTitle}
          >
            {props.paused ? (
              <Play size={12} aria-hidden="true" />
            ) : (
              <Pause size={12} aria-hidden="true" />
            )}
            {props.controlBusy
              ? copy.working
              : props.paused
                ? copy.resume
                : copy.pause}
          </button>
          <button
            type="button"
            disabled={props.controlBusy}
            onClick={() => void props.onOpenTakeover()}
          >
            {copy.takeover}
          </button>
          <button
            type="button"
            aria-busy={props.refreshing}
            disabled={props.refreshing}
            onClick={() => void props.onRefresh()}
          >
            <RefreshCw size={12} aria-hidden="true" />
            {copy.refresh}
          </button>
        </div>
      </header>
      <div
        className={`browser-live-activity is-${props.activity.state}`}
        role="status"
        aria-live="polite"
      >
        <span>{props.activity.label}</span>
      </div>
      {diagnosisActive ? (
        <BrowserLiveDiagnosis
          diagnosis={diagnosis}
          busy={props.controlBusy}
          onTakeover={props.onOpenTakeover}
        />
      ) : null}
      <img src={props.imageUrl} alt={copy.viewportAlt} />
      {props.paused && props.takeoverOpen ? (
        <Suspense
          fallback={
            <div className="browser-takeover-loading" role="status">
              {copy.openingControls}
            </div>
          }
        >
          <LazyBrowserTakeoverDesk
            threadId={props.threadId}
            runId={props.runId}
            liveImageUrl={props.imageUrl}
            liveReceipt={props.receipt}
            onActivityChange={props.onOperatorAction}
            onReturnToAgent={props.onReturnToAgent}
          />
        </Suspense>
      ) : null}
      <BrowserLiveFooter
        receipt={props.receipt}
        controlFailed={props.controlFailed}
      />
    </section>
  );
}

export interface BrowserLiveDiagnosisProps {
  diagnosis: "challenge_detected" | "login_required";
  busy: boolean;
  onTakeover: () => Promise<void>;
}

function BrowserLiveDiagnosis({
  diagnosis,
  busy,
  onTakeover,
}: BrowserLiveDiagnosisProps) {
  const copy = browserLiveCopy.live;
  return (
    <div className="browser-page-diagnosis" role="status" aria-live="polite">
      <ShieldAlert size={16} aria-hidden="true" />
      <div>
        <strong>
          {diagnosis === "challenge_detected"
            ? copy.humanVerification
            : copy.loginRequired}
        </strong>
        <span>{copy.diagnosisDescription}</span>
      </div>
      <button type="button" disabled={busy} onClick={() => void onTakeover()}>
        {copy.takeover}
      </button>
    </div>
  );
}

export interface BrowserLiveFooterProps {
  receipt: BrowserLiveViewReceipt;
  controlFailed: boolean;
}

function BrowserLiveFooter({ receipt, controlFailed }: BrowserLiveFooterProps) {
  const copy = browserLiveCopy.live;
  const plural = getLocale() === "en" && receipt.tabCount !== 1 ? "s" : "";
  return (
    <footer>
      <span>
        {copy.operation} {String(receipt.sessionOperation)}
      </span>
      <span>
        {receipt.activeTabId} · {String(receipt.tabCount)} {copy.tab}
        {plural}
      </span>
      <span title={receipt.currentOriginSha256}>
        {copy.origin} {receipt.currentOriginSha256.slice(0, 10)}
      </span>
      <span>
        {new Date(receipt.capturedAt).toLocaleTimeString(
          getLocale() === "zh" ? "zh-CN" : "en",
        )}
      </span>
      {controlFailed ? <span>{copy.controlRetry}</span> : null}
    </footer>
  );
}
