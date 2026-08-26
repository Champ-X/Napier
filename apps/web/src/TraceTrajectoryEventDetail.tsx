import { useEffect, useRef, useState } from "react";
import { ArrowRight, ShieldAlert, X } from "lucide-react";

import type { TraceTrajectoryEvent } from "./trace-trajectory-model";
import { traceTrajectoryCopy } from "./trace-trajectory-copy";
import { traceTrajectoryEventDetailView } from "./trace-trajectory-event-detail-view";
import { traceTrajectoryEventHighlights } from "./trace-trajectory-presentation";

type DetailTab =
  | "diagnosis"
  | "summary"
  | "context"
  | "evidence"
  | "timing";

export interface TraceTrajectoryEventDetailProps {
  event: TraceTrajectoryEvent;
  events?: readonly TraceTrajectoryEvent[];
  onSelectEvent?(eventId: string): void;
  onClose?: () => void;
  /**
   * Rendered inside the unified {@link ContextInspector}: the shared column owns
   * the frame, title, pin and close, so the detail drops its own heading and
   * lets the inspector body scroll (design §9.6).
   */
  embedded?: boolean;
}

export function TraceTrajectoryEventDetail({
  event,
  events = [event],
  onSelectEvent,
  onClose,
  embedded = false,
}: TraceTrajectoryEventDetailProps) {
  const [tab, setTab] = useState<DetailTab>(initialTab(event));
  const selectedEventId = useRef(event.event.id);
  const detail = traceTrajectoryEventDetailView(event, events);
  const tabs: DetailTab[] = detail.diagnosis
    ? ["diagnosis", "summary", "context", "evidence", "timing"]
    : ["summary", "context", "evidence", "timing"];
  const highlights = traceTrajectoryEventHighlights(event, detail.evidence);
  const copy = traceTrajectoryCopy.detail;
  useEffect(() => {
    if (selectedEventId.current === event.event.id) return;
    selectedEventId.current = event.event.id;
    setTab(initialTab(event));
  }, [event]);
  return (
    <section
      className={`trace-event-detail${embedded ? " is-embedded" : ""}`}
      aria-label={copy.label}
    >
      {embedded ? (
        <div className="trace-event-detail-meta">
          <span>
            {event.role} · #{String(event.event.seq).padStart(3, "0")}
          </span>
          <i className={`status-${event.status}`}>
            {traceTrajectoryCopy.statuses[event.status]}
          </i>
        </div>
      ) : (
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
      )}
      <div
        className="trace-event-detail-tabs"
        role="tablist"
        aria-label={copy.tabs}
      >
        {tabs.map((candidate) => (
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
        {tab === "diagnosis" && detail.diagnosis ? (
          <DiagnosisPanel
            diagnosis={detail.diagnosis}
            {...(onSelectEvent ? { onSelectEvent } : {})}
          />
        ) : null}
        {tab === "summary" ? (
          <div className="trace-event-detail-summary">
            <div className="trace-event-detail-callout">
              <span>{copy.atAGlance}</span>
              <p>{event.summary}</p>
            </div>
            <DetailGrid fields={highlights} />
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

function DiagnosisPanel({
  diagnosis,
  onSelectEvent,
}: {
  diagnosis: NonNullable<
    ReturnType<typeof traceTrajectoryEventDetailView>["diagnosis"]
  >;
  onSelectEvent?: (eventId: string) => void;
}) {
  const copy = traceTrajectoryCopy.detail.diagnosisView;
  return (
    <div className="trace-event-diagnosis">
      <div className="trace-event-diagnosis-summary">
        <ShieldAlert size={17} aria-hidden="true" />
        <div>
          <span>{copy.category}</span>
          <strong>{copy.categories[diagnosis.category]}</strong>
          <dl className="trace-event-diagnosis-guidance">
            <div>
              <dt>{copy.safeSummary}</dt>
              <dd>{copy.summaries[diagnosis.category]}</dd>
            </div>
            <div>
              <dt>{copy.nextAction}</dt>
              <dd>{copy.guidance[diagnosis.category]}</dd>
            </div>
          </dl>
        </div>
      </div>
      {diagnosis.subject ? (
        <DetailGrid
          fields={[{ key: "failureSubject", value: diagnosis.subject }]}
        />
      ) : null}
      <DiagnosisGroup
        title={copy.input}
        fields={diagnosis.input}
        empty={copy.inputUnknown}
      />
      <DiagnosisGroup
        title={copy.outcome}
        fields={diagnosis.outcome}
        empty={copy.outcomeUnknown}
      />
      <DiagnosisGroup
        title={copy.parent}
        fields={diagnosis.parent}
        empty={copy.parentUnknown}
      />
      <section className="trace-event-diagnosis-group">
        <h4>{copy.related}</h4>
        <ol className="trace-event-related-events">
          {diagnosis.related.map((related) => (
            <li key={`${related.relation}:${related.eventId}`}>
              <button
                type="button"
                disabled={!onSelectEvent}
                onClick={() => onSelectEvent?.(related.eventId)}
              >
                <span>{copy.relations[related.relation]}</span>
                <strong>{related.label}</strong>
                <code>#{String(related.sequence).padStart(3, "0")}</code>
                <ArrowRight size={13} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ol>
      </section>
      <p className="trace-event-diagnosis-privacy">{copy.privacy}</p>
    </div>
  );
}

function DiagnosisGroup({
  title,
  fields,
  empty,
}: {
  title: string;
  fields: ReturnType<typeof traceTrajectoryEventDetailView>["context"];
  empty: string;
}) {
  return (
    <section className="trace-event-diagnosis-group">
      <h4>{title}</h4>
      {fields.length > 0 ? (
        <DetailGrid fields={fields} />
      ) : (
        <p className="trace-event-detail-empty">{empty}</p>
      )}
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

function initialTab(event: TraceTrajectoryEvent): DetailTab {
  return event.status === "failed" ? "diagnosis" : "summary";
}
