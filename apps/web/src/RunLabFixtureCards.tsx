import { useRef } from "react";
import { BookOpen, Download, ShieldCheck, Upload } from "lucide-react";

import { copy } from "./copy";
import type { WebThreadDetail } from "./api";
import type {
  FixtureTransferReceipt,
  RunReplayVerificationReceipt,
} from "./use-workspace-view-model";
import { importProvenanceReceiptView } from "./use-workspace-view-model";

export function RunReplayVerifier({
  busyAction,
  receipt,
  onVerify,
}: {
  busyAction: string | undefined;
  receipt: RunReplayVerificationReceipt | undefined;
  onVerify: (file: File) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = Boolean(busyAction);
  return (
    <section
      className="fixture-docket replay-verifier-card"
      aria-labelledby="run-replay-verify-title"
    >
      <header>
        <div>
          <span>{copy.lab.replay.eyebrow}</span>
          <h3 id="run-replay-verify-title">{copy.lab.replay.title}</h3>
        </div>
        <BookOpen size={15} aria-hidden="true" />
      </header>
      <p>{copy.lab.replay.body}</p>
      <div className="fixture-actions replay-actions">
        <button
          className="fixture-verify"
          type="button"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          <Upload size={12} aria-hidden="true" />
          {busyAction === "run-replay-verify"
            ? copy.lab.replay.verifying
            : copy.lab.replay.verify}
        </button>
        <input
          ref={fileInput}
          className="fixture-file-input"
          type="file"
          accept="application/json,.json"
          tabIndex={-1}
          aria-label={copy.lab.replay.verify}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) onVerify(file);
          }}
        />
      </div>
      {receipt ? (
        <output
          className={`fixture-receipt status-${receipt.status}`}
          aria-live="polite"
        >
          <span>
            {receipt.status === "valid"
              ? copy.lab.replay.verified
              : copy.lab.replay.invalid}
          </span>
          {receipt.contentSha256 ? (
            <code>{receipt.contentSha256.slice(0, 12)}</code>
          ) : null}
          <small>
            {receipt.eventCount.toLocaleString()} {copy.lab.fixture.events} ·{" "}
            {receipt.subagentCount.toLocaleString()} {copy.lab.replay.subagents}
          </small>
          <small>
            {receipt.modelContextEnvelopeCount.toLocaleString()}{" "}
            {copy.lab.fixture.contextEnvelopes} ·{" "}
            {receipt.embeddedModelContextEnvelopeCount.toLocaleString()}{" "}
            {copy.lab.fixture.embeddedEnvelopes}
          </small>
          <small className="fixture-diagnostics">
            {receipt.diagnostics.length > 0
              ? receipt.diagnostics.join(", ")
              : copy.lab.fixture.noDiagnostics}
          </small>
        </output>
      ) : null}
    </section>
  );
}

export function FixtureLedgerCard({
  detail,
  busyAction,
  receipt,
  onExport,
  onVerify,
  onImport,
}: {
  detail: WebThreadDetail;
  busyAction: string | undefined;
  receipt: FixtureTransferReceipt | undefined;
  onExport: () => void;
  onVerify: (file: File) => void;
  onImport: (file: File) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const verifyInput = useRef<HTMLInputElement>(null);
  const busy = Boolean(busyAction);
  const provenance = detail.thread.importProvenance;
  const importReceipt = importProvenanceReceiptView(detail);

  return (
    <section className="fixture-docket" aria-labelledby="fixture-docket-title">
      <header>
        <div>
          <span>{copy.lab.fixture.eyebrow}</span>
          <h3 id="fixture-docket-title">{copy.lab.fixture.title}</h3>
        </div>
        <ShieldCheck size={15} aria-hidden="true" />
      </header>
      <p>{copy.lab.fixture.body}</p>
      <dl className="fixture-register">
        <div>
          <dt>{copy.lab.fixture.events}</dt>
          <dd>{detail.events.length.toLocaleString()}</dd>
        </div>
        <div>
          <dt>{copy.lab.fixture.runs}</dt>
          <dd>{detail.runs.length.toLocaleString()}</dd>
        </div>
        <div>
          <dt>{copy.lab.fixture.plans}</dt>
          <dd>{detail.plans.length.toLocaleString()}</dd>
        </div>
        <div>
          <dt>{copy.lab.fixture.evaluations}</dt>
          <dd>{detail.evaluations.length.toLocaleString()}</dd>
        </div>
      </dl>
      {provenance ? (
        <div className="fixture-origin">
          <span>{copy.lab.fixture.importedSource}</span>
          <code title={provenance.sourceContentSha256}>
            {provenance.sourceContentSha256.slice(0, 12)}
          </code>
          <small>
            {provenance.sourceEventCount.toLocaleString()}{" "}
            {copy.lab.fixture.sourceEvents} ·{" "}
            {(
              provenance.localImportedThroughSeq ?? provenance.sourceEventCount
            ).toLocaleString()}{" "}
            {copy.lab.fixture.localImportedCutoff}
          </small>
          <small>
            {(provenance.sourceModelContextEnvelopeCount ?? 0).toLocaleString()}{" "}
            {copy.lab.fixture.contextEnvelopes} ·{" "}
            {(
              provenance.sourceEmbeddedModelContextEnvelopeCount ?? 0
            ).toLocaleString()}{" "}
            {copy.lab.fixture.embeddedEnvelopes}
          </small>
          {importReceipt ? (
            <small>
              {copy.lab.fixture.importReceipt}{" "}
              {importReceipt.seq.toLocaleString()} ·{" "}
              <code title={importReceipt.payloadSha256}>
                {importReceipt.payloadSha256.slice(0, 12)}
              </code>
            </small>
          ) : null}
        </div>
      ) : null}
      <div className="fixture-actions">
        <button type="button" disabled={busy} onClick={onExport}>
          <Download size={12} aria-hidden="true" />
          {busyAction === "fixture-export"
            ? copy.lab.fixture.exporting
            : copy.lab.fixture.export}
        </button>
        <button
          className="fixture-verify"
          type="button"
          disabled={busy}
          onClick={() => verifyInput.current?.click()}
        >
          <ShieldCheck size={12} aria-hidden="true" />
          {busyAction === "fixture-verify"
            ? copy.lab.fixture.verifying
            : copy.lab.fixture.verify}
        </button>
        <button
          className="fixture-import"
          type="button"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          <Upload size={12} aria-hidden="true" />
          {busyAction === "fixture-import"
            ? copy.lab.fixture.importing
            : copy.lab.fixture.import}
        </button>
        <input
          ref={fileInput}
          className="fixture-file-input"
          type="file"
          accept="application/json,.json"
          tabIndex={-1}
          aria-label={copy.lab.fixture.import}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) onImport(file);
          }}
        />
        <input
          ref={verifyInput}
          className="fixture-file-input"
          type="file"
          accept="application/json,.json"
          tabIndex={-1}
          aria-label={copy.lab.fixture.verify}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) onVerify(file);
          }}
        />
      </div>
      <p className="fixture-safety">
        <ShieldCheck size={11} aria-hidden="true" />
        {copy.lab.fixture.safety}
      </p>
      {receipt ? (
        <output
          className={`fixture-receipt ${receipt.action === "verified" ? `status-${receipt.status}` : ""}`}
          aria-live="polite"
        >
          <span>
            {receipt.action === "verified"
              ? receipt.status === "valid"
                ? copy.lab.fixture.receipts.verified
                : copy.lab.fixture.receipts.invalid
              : copy.lab.fixture.receipts[receipt.action]}
          </span>
          {receipt.contentSha256 ? (
            <code>{receipt.contentSha256.slice(0, 12)}</code>
          ) : null}
          <small>
            {receipt.eventCount.toLocaleString()} {copy.lab.fixture.events} ·{" "}
            {receipt.runCount.toLocaleString()} {copy.lab.fixture.runs} ·{" "}
            {receipt.planCount.toLocaleString()} {copy.lab.fixture.plans} ·{" "}
            {receipt.evaluationCount.toLocaleString()}{" "}
            {copy.lab.fixture.evaluations}
          </small>
          <small>
            {receipt.modelContextEnvelopeCount.toLocaleString()}{" "}
            {copy.lab.fixture.contextEnvelopes} ·{" "}
            {receipt.embeddedModelContextEnvelopeCount.toLocaleString()}{" "}
            {copy.lab.fixture.embeddedEnvelopes}
          </small>
          {receipt.action === "verified" ? (
            <small className="fixture-diagnostics">
              {receipt.diagnostics.length > 0
                ? receipt.diagnostics.join(", ")
                : copy.lab.fixture.noDiagnostics}
            </small>
          ) : null}
        </output>
      ) : null}
    </section>
  );
}
