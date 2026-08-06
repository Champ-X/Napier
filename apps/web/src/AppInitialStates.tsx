import { AlertCircle } from "lucide-react";

import { copy } from "./copy";

export function LoadingShell() {
  return (
    <div className="loading-shell" aria-label="Loading Napier" role="status">
      <div className="loading-monogram">N</div>
      <span>Opening the ledger</span>
    </div>
  );
}

export function FatalState({ message }: { message: string }) {
  return (
    <main className="fatal-state">
      <AlertCircle size={26} aria-hidden="true" />
      <h1>{copy.notices.disconnected}</h1>
      <p>{message}</p>
    </main>
  );
}
