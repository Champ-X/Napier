import type { ReactNode } from "react";
import { useEffect, useId, useState } from "react";
import { PanelRightClose, PanelRightOpen, X } from "lucide-react";

export function ResponsiveInspector({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const inspectorId = useId();

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  return (
    <>
      <button
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
          onClick={() => setOpen(false)}
        />
      ) : null}
      <aside
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
            onClick={() => setOpen(false)}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </header>
        {children}
      </aside>
    </>
  );
}
