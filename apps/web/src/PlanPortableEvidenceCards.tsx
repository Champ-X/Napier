import { useRef } from "react";
import { ChevronRight, Download, ShieldCheck, Upload } from "lucide-react";

import type {
  ExecutionPlanArchiveVerification,
  ExecutionPlanBlueprintVerification,
} from "@napier/contracts";

import { planCopy } from "./plan-copy";

export type PlanArchiveReceipt =
  | {
      action: "exported";
      contentSha256: string;
      eventStreamSha256: string;
      revision: number;
      eventCount: number;
      stepCount: number;
      artifactCount: number;
      replanCount: number;
    }
  | {
      action: "verified";
      status: ExecutionPlanArchiveVerification["status"];
      diagnostics: string[];
      contentSha256?: string;
      eventStreamSha256?: string;
      revision?: number;
      eventCount: number;
      stepCount: number;
      artifactCount: number;
      replanCount: number;
    };

export type PlanBlueprintReceipt =
  | {
      action: "exported";
      contentSha256: string;
      sourcePlanRevision: number;
      stepCount: number;
      artifactCount: number;
    }
  | {
      action: "verified";
      status: ExecutionPlanBlueprintVerification["status"];
      diagnostics: string[];
      contentSha256?: string;
      sourcePlanRevision?: number;
      stepCount: number;
      artifactCount: number;
    }
  | {
      action: "created";
      contentSha256: string;
      planId: string;
      stepCount: number;
      artifactCount: number;
    };

export function PlanArchiveCard({
  receipt,
  busyAction,
  error,
  onExport,
  onVerify,
}: {
  receipt: PlanArchiveReceipt | undefined;
  busyAction: "export" | "verify" | undefined;
  error: string | undefined;
  onExport: () => void;
  onVerify: (file: File) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <section
      className="fixture-docket plan-archive-card"
      aria-labelledby="plan-archive-title"
    >
      <header>
        <div>
          <span>{planCopy.archive.eyebrow}</span>
          <h3 id="plan-archive-title">{planCopy.archive.title}</h3>
        </div>
        <Download size={14} aria-hidden="true" />
      </header>
      <p>{planCopy.archive.body}</p>
      <div className="fixture-actions">
        <button type="button" disabled={Boolean(busyAction)} onClick={onExport}>
          <Download size={12} aria-hidden="true" />
          {busyAction === "export"
            ? planCopy.archive.exporting
            : planCopy.archive.export}
        </button>
        <button
          className="fixture-verify"
          type="button"
          disabled={Boolean(busyAction)}
          onClick={() => fileInput.current?.click()}
        >
          <Upload size={12} aria-hidden="true" />
          {busyAction === "verify"
            ? planCopy.archive.verifying
            : planCopy.archive.verify}
        </button>
        <input
          ref={fileInput}
          className="fixture-file-input"
          type="file"
          accept="application/json,.json"
          aria-label={planCopy.archive.verify}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) onVerify(file);
          }}
        />
      </div>
      {receipt ? <PlanArchiveReceiptView receipt={receipt} /> : null}
      {error ? <p className="plan-review-error">{error}</p> : null}
      <p className="fixture-safety">
        <ShieldCheck size={13} aria-hidden="true" />
        {planCopy.archive.safety}
      </p>
    </section>
  );
}

export function PlanBlueprintCard({
  hasPlan,
  canCreate,
  receipt,
  busyAction,
  error,
  onExport,
  onVerify,
  onCreate,
}: {
  hasPlan: boolean;
  canCreate: boolean;
  receipt: PlanBlueprintReceipt | undefined;
  busyAction: "export" | "verify" | "create" | undefined;
  error: string | undefined;
  onExport: () => void;
  onVerify: (file: File) => void;
  onCreate: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <section
      className="fixture-docket plan-blueprint-card"
      aria-labelledby="plan-blueprint-title"
    >
      <header>
        <div>
          <span>{planCopy.blueprint.eyebrow}</span>
          <h3 id="plan-blueprint-title">{planCopy.blueprint.title}</h3>
        </div>
        <Download size={14} aria-hidden="true" />
      </header>
      <p>{planCopy.blueprint.body}</p>
      <div className="fixture-actions">
        <button
          type="button"
          disabled={Boolean(busyAction) || !hasPlan}
          onClick={onExport}
        >
          <Download size={12} aria-hidden="true" />
          {busyAction === "export"
            ? planCopy.blueprint.exporting
            : planCopy.blueprint.export}
        </button>
        <button
          className="fixture-verify"
          type="button"
          disabled={Boolean(busyAction)}
          onClick={() => fileInput.current?.click()}
        >
          <Upload size={12} aria-hidden="true" />
          {busyAction === "verify"
            ? planCopy.blueprint.verifying
            : planCopy.blueprint.verify}
        </button>
        <button
          className="fixture-import"
          type="button"
          disabled={Boolean(busyAction) || !canCreate}
          onClick={onCreate}
        >
          <ChevronRight size={12} aria-hidden="true" />
          {busyAction === "create"
            ? planCopy.blueprint.creating
            : planCopy.blueprint.create}
        </button>
        <input
          ref={fileInput}
          className="fixture-file-input"
          type="file"
          accept="application/json,.json"
          aria-label={planCopy.blueprint.verify}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) onVerify(file);
          }}
        />
      </div>
      {receipt ? <PlanBlueprintReceiptView receipt={receipt} /> : null}
      {error ? <p className="plan-review-error">{error}</p> : null}
      <p className="fixture-safety">
        <ShieldCheck size={13} aria-hidden="true" />
        {planCopy.blueprint.safety}
      </p>
    </section>
  );
}

function PlanArchiveReceiptView({ receipt }: { receipt: PlanArchiveReceipt }) {
  const view = projectPlanArchiveReceiptView(receipt);
  return (
    <div className={`fixture-receipt status-${view.status}`}>
      <span>{view.title}</span>
      {view.contentSha256 ? <code>{view.contentSha256}</code> : null}
      <small>{view.summary}</small>
      {view.eventStreamSha256 ? (
        <small>
          {planCopy.archive.eventStream}: {view.eventStreamSha256}
        </small>
      ) : null}
      {view.diagnostics ? (
        <small className="fixture-diagnostics">{view.diagnostics}</small>
      ) : null}
    </div>
  );
}

function PlanBlueprintReceiptView({
  receipt,
}: {
  receipt: PlanBlueprintReceipt;
}) {
  const view = projectPlanBlueprintReceiptView(receipt);
  return (
    <div className={`fixture-receipt status-${view.status}`}>
      <span>{view.title}</span>
      {view.contentSha256 ? <code>{view.contentSha256}</code> : null}
      <small>{view.summary}</small>
      {view.diagnostics ? (
        <small className="fixture-diagnostics">{view.diagnostics}</small>
      ) : null}
    </div>
  );
}

export function projectPlanArchiveReceiptView(receipt: PlanArchiveReceipt) {
  return {
    status: receipt.action === "verified" ? receipt.status : "valid",
    title:
      receipt.action === "exported"
        ? planCopy.archive.exported
        : receipt.status === "valid"
          ? planCopy.archive.verified
          : planCopy.archive.invalid,
    contentSha256: receipt.contentSha256?.slice(0, 16),
    summary: `${receipt.revision !== undefined ? `r${receipt.revision} / ` : ""}${receipt.eventCount.toLocaleString()} ${planCopy.archive.events} / ${receipt.stepCount.toLocaleString()} ${planCopy.archive.steps} / ${receipt.artifactCount.toLocaleString()} ${planCopy.archive.artifacts} / ${receipt.replanCount.toLocaleString()} ${planCopy.archive.replans}`,
    eventStreamSha256: receipt.eventStreamSha256?.slice(0, 16),
    diagnostics:
      receipt.action === "verified"
        ? receipt.diagnostics.length > 0
          ? receipt.diagnostics.join(", ")
          : planCopy.archive.noDiagnostics
        : undefined,
  };
}

export function projectPlanBlueprintReceiptView(receipt: PlanBlueprintReceipt) {
  return {
    status: receipt.action === "verified" ? receipt.status : "valid",
    title:
      receipt.action === "exported"
        ? planCopy.blueprint.exported
        : receipt.action === "created"
          ? planCopy.blueprint.created
          : receipt.status === "valid"
            ? planCopy.blueprint.verified
            : planCopy.blueprint.invalid,
    contentSha256: receipt.contentSha256?.slice(0, 16),
    summary: `${"sourcePlanRevision" in receipt && receipt.sourcePlanRevision !== undefined ? `r${receipt.sourcePlanRevision} / ` : ""}${receipt.stepCount.toLocaleString()} ${planCopy.blueprint.steps} / ${receipt.artifactCount.toLocaleString()} ${planCopy.blueprint.artifacts}${"planId" in receipt ? ` / ${shortId(receipt.planId)}` : ""}`,
    diagnostics:
      receipt.action === "verified"
        ? receipt.diagnostics.length > 0
          ? receipt.diagnostics.join(", ")
          : planCopy.blueprint.noDiagnostics
        : undefined,
  };
}

function shortId(value: string): string {
  return value.length > 15
    ? `${value.slice(0, 7)}...${value.slice(-5)}`
    : value;
}
