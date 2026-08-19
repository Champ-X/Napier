import type { ReactNode } from "react";

export interface ContextLedgerRowProps {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}

export function ContextLedgerRow({
  icon,
  label,
  children,
}: ContextLedgerRowProps) {
  return (
    <div className="context-row">
      <dt>
        {icon}
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}
