import { Check, ChevronRight, Copy } from "lucide-react";
import { useState } from "react";

import { traceTrajectoryCopy } from "./trace-trajectory-copy";
import type { TraceTrajectoryPreviewSection } from "./trace-trajectory-presentation";

export function TraceTrajectoryPreview({
  sections,
  compact = false,
}: {
  sections: TraceTrajectoryPreviewSection[];
  compact?: boolean;
}) {
  return (
    <div className="trace-event-preview">
      {sections.map((section) => (
        <PreviewSection key={section.id} section={section} compact={compact} />
      ))}
    </div>
  );
}

function PreviewSection({
  section,
  compact,
}: {
  section: TraceTrajectoryPreviewSection;
  compact: boolean;
}) {
  const [copiedValue, setCopiedValue] = useState<string>();
  const [failed, setFailed] = useState(false);
  const copied = copiedValue === section.value;
  const copy = traceTrajectoryCopy;
  const content = section.code ? (
    <pre tabIndex={0}>
      <code>{prettyCode(section.value)}</code>
    </pre>
  ) : (
    <p tabIndex={0}>{section.value}</p>
  );
  const copyContent = async () => {
    try {
      await navigator.clipboard.writeText(section.value);
      setCopiedValue(section.value);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  };
  return (
    <section className={`trace-preview-${section.id}`}>
      <header>
        <h4>{section.label}</h4>
        <span className="trace-preview-actions">
          {section.localOnly ? <small>{copy.detail.localOnly}</small> : null}
          <button
            type="button"
            onClick={() => void copyContent()}
            aria-label={`${copied ? copy.insights.copied : copy.insights.copy} · ${section.label}`}
            title={copied ? copy.insights.copied : copy.insights.copy}
          >
            {copied ? (
              <Check size={13} aria-hidden="true" />
            ) : (
              <Copy size={13} aria-hidden="true" />
            )}
          </button>
        </span>
      </header>
      {compact && section.id === "thinking" ? (
        <details>
          <summary>
            <ChevronRight size={13} aria-hidden="true" />
            <span>{section.value.replace(/\s+/gu, " ").slice(0, 110)}</span>
          </summary>
          {content}
        </details>
      ) : (
        content
      )}
      {failed ? <p role="status">{copy.insights.copyFailed}</p> : null}
    </section>
  );
}

function prettyCode(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}
