import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import "./DisclosureRow.css";

export type DisclosureRowStatus =
  | "neutral"
  | "running"
  | "success"
  | "warning"
  | "danger";

export interface DisclosureRowProps {
  /** Stable id used to wire the summary control to its expandable region. */
  id: string;
  /** Primary scannable label for the row. */
  title: string;
  /** Optional one-line summary shown next to the title; truncates on overflow. */
  summary?: ReactNode;
  /** Semantic status driving the accent rail and status text tone. */
  status?: DisclosureRowStatus;
  /** Short, already-localized status word (e.g. 运行中). No default copy. */
  statusLabel?: ReactNode;
  /** Trailing metadata such as elapsed time; rendered muted and monospaced. */
  meta?: ReactNode;
  /** Leading glyph, typically a lucide icon sized 14–15px. */
  icon?: ReactNode;
  /** Whether the expandable region is currently open. */
  open: boolean;
  /** Disables the control and hides the region regardless of `open`. */
  disabled?: boolean;
  /** Called with the requested next open state when the summary is activated. */
  onToggle(open: boolean): void;
  /** Expandable detail content; omitted rows still render a static summary. */
  children?: ReactNode;
}

export function DisclosureRow({
  id,
  title,
  summary,
  status = "neutral",
  statusLabel,
  meta,
  icon,
  open,
  disabled = false,
  onToggle,
  children,
}: DisclosureRowProps) {
  const regionId = `${id}-region`;
  const summaryId = `${id}-summary`;
  const expandable = children !== undefined && children !== null;
  const expanded = expandable && open && !disabled;
  return (
    <div className={`disclosure-row status-${status}`} data-open={expanded}>
      <button
        id={summaryId}
        type="button"
        className="disclosure-row-summary"
        aria-expanded={expandable ? expanded : undefined}
        aria-controls={expandable ? regionId : undefined}
        disabled={disabled || !expandable}
        onClick={() => onToggle(!open)}
      >
        {expandable ? (
          <ChevronRight
            className="disclosure-row-caret"
            size={14}
            aria-hidden="true"
          />
        ) : (
          <span className="disclosure-row-caret-placeholder" aria-hidden="true" />
        )}
        {icon ? (
          <span className="disclosure-row-icon" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        <span className="disclosure-row-title">{title}</span>
        {summary ? (
          <span className="disclosure-row-secondary">{summary}</span>
        ) : null}
        {statusLabel ? (
          <span className="disclosure-row-status">{statusLabel}</span>
        ) : null}
        {meta ? <span className="disclosure-row-meta">{meta}</span> : null}
      </button>
      {expandable ? (
        <div
          id={regionId}
          role="region"
          aria-labelledby={summaryId}
          className="disclosure-row-region"
          hidden={!expanded}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
