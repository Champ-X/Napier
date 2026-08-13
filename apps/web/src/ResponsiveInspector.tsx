import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { PanelRightClose, PanelRightOpen, X } from "lucide-react";

export function ResponsiveInspector({
  label,
  openRequest = 0,
  children,
}: {
  label: string;
  openRequest?: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const inspectorId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inspectorRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (openRequest > 0) setOpen(true);
  }, [openRequest]);

  useEffect(() => {
    if (!open) return;
    const focusTimer = window.setTimeout(() => {
      inspectorRef.current
        ?.querySelector<HTMLButtonElement>(
          '.inspector-groups [role="tab"][aria-selected="true"]',
        )
        ?.focus();
    }, 200);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        className="inspector-drawer-trigger"
        type="button"
        aria-controls={inspectorId}
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <PanelRightOpen size={15} aria-hidden="true" />
        {label}
      </button>
      {open ? (
        <button
          className="inspector-drawer-backdrop"
          type="button"
          aria-label={`Close ${label}`}
          onClick={() => {
            setOpen(false);
            triggerRef.current?.focus();
          }}
        />
      ) : null}
      <aside
        ref={inspectorRef}
        id={inspectorId}
        className={`inspector${open ? " is-drawer-open" : ""}`}
        aria-label={label}
      >
        <header className="inspector-drawer-header">
          <span>
            <PanelRightClose size={15} aria-hidden="true" />
            {label}
          </span>
          <button
            type="button"
            aria-label={`Close ${label}`}
            onClick={() => {
              setOpen(false);
              triggerRef.current?.focus();
            }}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </header>
        {children}
      </aside>
    </>
  );
}
