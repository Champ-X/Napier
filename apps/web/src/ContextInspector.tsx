import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { Pin, PinOff, X } from "lucide-react";

import { contextInspectorCopy } from "./context-inspector-copy";

export type ContextInspectorObjectType = "event" | "tool" | "evidence";

export interface ContextInspectorObject {
  /** Stable identity of the surfaced object; a change swaps content in place. */
  id: string;
  /** Object class shown as the header eyebrow (localized, no default copy). */
  type: ContextInspectorObjectType;
  /** Human title of the object, rendered in the header. */
  title: string;
  /** The single detail body for this object. */
  content: ReactNode;
}

export interface ContextInspectorProps {
  /** The one object currently surfaced; `undefined` keeps the column closed. */
  object: ContextInspectorObject | undefined;
  /** Whether the object is pinned; pinning is owned by the caller. */
  pinned?: boolean;
  /** Requests a pinned-state change from the header toggle. */
  onTogglePin?(pinned: boolean): void;
  /** Requests the column be closed; the caller clears the selection. */
  onClose(): void;
}

/**
 * Unified right-column context inspector (design §9.6). It surfaces exactly one
 * context object at a time — a trajectory event, a tool call, or an evidence
 * item — behind a single header (type, title, pin, close). Selecting a new
 * object updates the body in place instead of stacking nested panels, and
 * closing returns focus to whatever element opened it.
 */
export function ContextInspector({
  object,
  pinned = false,
  onTogglePin,
  onClose,
}: ContextInspectorProps) {
  const regionRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const open = object !== undefined;

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      // Capture the trigger before moving focus into the column so closing can
      // return focus to it (§18.3). Reading activeElement first is deliberate.
      const active =
        typeof document === "undefined"
          ? null
          : (document.activeElement as HTMLElement | null);
      openerRef.current = active;
      regionRef.current?.focus();
    } else if (!open && wasOpenRef.current) {
      openerRef.current?.focus();
      openerRef.current = null;
    }
    wasOpenRef.current = open;
  }, [open]);

  if (!object) return null;
  const copy = contextInspectorCopy;
  return (
    <aside
      ref={regionRef}
      className="context-inspector"
      tabIndex={-1}
      aria-label={copy.label}
    >
      <header className="context-inspector-heading">
        <div className="context-inspector-identity">
          <span className={`context-inspector-type type-${object.type}`}>
            {copy.typeLabels[object.type]}
          </span>
          <strong title={object.title}>{object.title}</strong>
        </div>
        <div className="context-inspector-actions">
          {onTogglePin ? (
            <button
              type="button"
              className={`context-inspector-pin${pinned ? " is-pinned" : ""}`}
              aria-pressed={pinned}
              aria-label={pinned ? copy.unpin : copy.pin}
              onClick={() => onTogglePin(!pinned)}
            >
              {pinned ? (
                <PinOff size={14} aria-hidden="true" />
              ) : (
                <Pin size={14} aria-hidden="true" />
              )}
            </button>
          ) : null}
          <button
            type="button"
            className="context-inspector-close"
            aria-label={copy.close}
            onClick={onClose}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="context-inspector-body">{object.content}</div>
    </aside>
  );
}
