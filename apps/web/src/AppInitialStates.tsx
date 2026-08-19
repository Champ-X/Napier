import { AlertCircle } from "lucide-react";

import { copy } from "./copy";
import { shellCopy } from "./shell-copy";

export function LoadingShell() {
  return (
    <div
      className="loading-shell"
      aria-label={shellCopy.initialStates.loadingAria}
      role="status"
    >
      <div className="loading-monogram">N</div>
      <span>{shellCopy.initialStates.openingLedger}</span>
    </div>
  );
}

export interface FatalStateProps {
  message: string;
}

export function FatalState({ message }: FatalStateProps) {
  return (
    <main className="fatal-state">
      <AlertCircle size={26} aria-hidden="true" />
      <h1>{copy.notices.disconnected}</h1>
      <p>{message}</p>
    </main>
  );
}
