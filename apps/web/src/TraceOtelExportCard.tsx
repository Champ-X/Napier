import { Activity, Download, ShieldCheck, Upload } from "lucide-react";

import type { RunRecord } from "@napier/contracts";

import { copy } from "./copy";
import type {
  OpenTelemetryTraceReceipt,
  OpenTelemetryTraceVerificationReceipt,
} from "./use-workspace-view-model";

export interface TraceOtelExportCardProps {
  runs: RunRecord[];
  exportRunId: string;
  exportBusy: boolean;
  exportReceipt: OpenTelemetryTraceReceipt | undefined;
  verifyBusy: boolean;
  verificationReceipt: OpenTelemetryTraceVerificationReceipt | undefined;
  onExportRunId(value: string): void;
  onExport(runId?: string): void;
  onVerify(file: File): void;
}

export function TraceOtelExportCard({
  runs,
  exportRunId,
  exportBusy,
  exportReceipt,
  verifyBusy,
  verificationReceipt,
  onExportRunId,
  onExport,
  onVerify,
}: TraceOtelExportCardProps) {
  return (
    <section className="otel-export-card" aria-labelledby="otel-export-title">
      <header>
        <div>
          <span>{copy.trace.otel.eyebrow}</span>
          <h3 id="otel-export-title">{copy.trace.otel.title}</h3>
        </div>
        <Activity size={14} aria-hidden="true" />
      </header>
      <p>{copy.trace.otel.body}</p>
      <div className="otel-export-controls">
        <label>
          <span>{copy.trace.otel.scope}</span>
          <select
            value={exportRunId}
            disabled={exportBusy}
            onChange={(event) => onExportRunId(event.target.value)}
          >
            <option value="">{copy.trace.otel.threadScope}</option>
            {runs
              .slice()
              .reverse()
              .map((run, index) => (
                <option key={run.id} value={run.id}>
                  {copy.trace.otel.runScope}{" "}
                  {String(runs.length - index).padStart(2, "0")} / {run.status}
                </option>
              ))}
          </select>
        </label>
        <button
          type="button"
          disabled={exportBusy}
          onClick={() => onExport(exportRunId || undefined)}
        >
          <Download size={11} aria-hidden="true" />
          {exportBusy ? copy.trace.otel.exporting : copy.trace.otel.export}
        </button>
        <label className="otel-file-action" aria-disabled={verifyBusy}>
          <Upload size={11} aria-hidden="true" />
          {verifyBusy ? copy.trace.otel.verifying : copy.trace.otel.verify}
          <input
            type="file"
            accept="application/json,.json"
            disabled={verifyBusy}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) onVerify(file);
            }}
          />
        </label>
      </div>
      {exportReceipt ? (
        <output className="otel-export-receipt" aria-live="polite">
          <span>
            <strong>{copy.trace.otel.exported}</strong>
            <small>
              {exportReceipt.scope === "thread"
                ? copy.trace.otel.threadScope
                : copy.trace.otel.runScope}
            </small>
          </span>
          <span>
            <small>{copy.trace.otel.spans}</small>
            <strong>{exportReceipt.spanCount}</strong>
          </span>
          <span>
            <small>{copy.trace.otel.events}</small>
            <strong>{exportReceipt.eventCount}</strong>
          </span>
          {exportReceipt.eventAnchorSetSha256 ? (
            <code title={exportReceipt.eventAnchorSetSha256}>
              {copy.trace.otel.eventAnchor}{" "}
              {exportReceipt.eventAnchorSetSha256.slice(0, 12)}
            </code>
          ) : null}
          <code title={exportReceipt.contentSha256}>
            {exportReceipt.contentSha256.slice(0, 12)}
          </code>
        </output>
      ) : null}
      {verificationReceipt ? (
        <output
          className={`otel-export-receipt status-${verificationReceipt.status}`}
          aria-live="polite"
        >
          <span>
            <strong>
              {verificationReceipt.status === "valid"
                ? copy.trace.otel.verified
                : copy.trace.otel.invalid}
            </strong>
            <small>
              {verificationReceipt.diagnostics.length > 0
                ? verificationReceipt.diagnostics.join(", ")
                : copy.trace.otel.noDiagnostics}
            </small>
          </span>
          <span>
            <small>{copy.trace.otel.spans}</small>
            <strong>{verificationReceipt.spanCount}</strong>
          </span>
          <span>
            <small>{copy.trace.otel.events}</small>
            <strong>{verificationReceipt.eventCount}</strong>
          </span>
          {verificationReceipt.eventAnchorSetSha256 ? (
            <code title={verificationReceipt.eventAnchorSetSha256}>
              {copy.trace.otel.eventAnchor}{" "}
              {verificationReceipt.eventAnchorSetSha256.slice(0, 12)}
            </code>
          ) : null}
          {verificationReceipt.contentSha256 ? (
            <code title={verificationReceipt.contentSha256}>
              {verificationReceipt.contentSha256.slice(0, 12)}
            </code>
          ) : null}
        </output>
      ) : null}
      <p className="otel-export-safety">
        <ShieldCheck size={10} aria-hidden="true" />
        {copy.trace.otel.safety}
      </p>
    </section>
  );
}
