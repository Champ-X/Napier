import { useState } from "react";
import { X } from "lucide-react";

import type { TraceTrajectoryEvent } from "./trace-trajectory-model";
import { traceTrajectoryCopy } from "./trace-trajectory-copy";
import { traceTrajectoryEventDetailView } from "./trace-trajectory-event-detail-view";

type DetailTab = "summary" | "context" | "evidence" | "timing";
const TABS: DetailTab[] = ["summary", "context", "evidence", "timing"];

export interface TraceTrajectoryEventDetailProps {
  event: TraceTrajectoryEvent;
  onClose?: () => void;
}

export function TraceTrajectoryEventDetail({
  event,
  onClose,
}: TraceTrajectoryEventDetailProps) {
  const [tab, setTab] = useState<DetailTab>("summary");
  const detail = traceTrajectoryEventDetailView(event);
  const copy = traceTrajectoryCopy.detail;
  return (
    <section className="trace-event-detail" aria-label={copy.label}>
      <header className="trace-event-detail-heading">
        <div>
          <span>
            {event.role} · #{String(event.event.seq).padStart(3, "0")}
          </span>
          <strong>{event.label}</strong>
        </div>
        <i className={`status-${event.status}`}>
          {traceTrajectoryCopy.statuses[event.status]}
        </i>
        {onClose ? (
          <button type="button" aria-label={copy.close} onClick={onClose}>
            <X size={14} aria-hidden="true" />
          </button>
        ) : null}
      </header>
      <div
        className="trace-event-detail-tabs"
        role="tablist"
        aria-label={copy.tabs}
      >
        {TABS.map((candidate) => (
          <button
            type="button"
            role="tab"
            aria-selected={tab === candidate}
            className={tab === candidate ? "is-active" : ""}
            key={candidate}
            onClick={() => setTab(candidate)}
          >
            {copy[candidate]}
            {candidate === "evidence" && detail.evidence.length > 0 ? (
              <span>{detail.evidence.length}</span>
            ) : null}
          </button>
        ))}
      </div>
      <div className="trace-event-detail-panel" role="tabpanel">
        {tab === "summary" ? (
          <div className="trace-event-detail-summary">
            <span>{event.label}</span>
            <p>{event.summary}</p>
          </div>
        ) : null}
        {tab === "context" ? <DetailGrid fields={detail.context} /> : null}
        {tab === "evidence" ? (
          detail.evidence.length > 0 ? (
            <DetailGrid fields={detail.evidence} />
          ) : (
            <p className="trace-event-detail-empty">{copy.noEvidence}</p>
          )
        ) : null}
        {tab === "timing" ? <DetailGrid fields={detail.timing} /> : null}
      </div>
    </section>
  );
}

function DetailGrid({
  fields,
}: {
  fields: ReturnType<typeof traceTrajectoryEventDetailView>["context"];
}) {
  return (
    <dl className="trace-event-detail-grid">
      {fields.map((item) => (
        <div key={item.key}>
          <dt>{fieldLabel(item.key)}</dt>
          <dd className={item.digest ? "is-digest" : undefined}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function fieldLabel(key: string): string {
  const localized =
    traceTrajectoryCopy.detail.fields[
      key as keyof typeof traceTrajectoryCopy.detail.fields
    ];
  if (localized) return localized;
  return key
    .replace(/Sha256$/u, " SHA-256")
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/^./u, (value) => value.toLocaleUpperCase());
}
