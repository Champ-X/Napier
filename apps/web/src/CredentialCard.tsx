import { RefreshCw } from "lucide-react";

import type {
  CredentialReference,
  CredentialReferenceSource,
} from "@napier/contracts";

import { contextCopy } from "./context-copy";
import "./credential-card.css";

export interface CredentialCardProps {
  reference: CredentialReference;
  busy: boolean;
  onCheck: (referenceId: string) => void;
  onToggle: (referenceId: string, enabled: boolean) => void;
}

export function CredentialCard({
  reference,
  busy,
  onCheck,
  onToggle,
}: CredentialCardProps) {
  const titleId = `credential-${reference.id}-title`;
  return (
    <article
      className={`credential-card availability-${reference.availability}`}
      aria-labelledby={titleId}
      aria-busy={busy}
    >
      <header>
        <div>
          <span>{reference.providerId}</span>
          <strong id={titleId}>{reference.label}</strong>
        </div>
        <span className={`credential-state state-${reference.status}`}>
          {contextCopy.credentialStatuses[reference.status]}
        </span>
      </header>
      <code>{credentialLocator(reference.source)}</code>
      <div className="credential-availability" role="status">
        <i aria-hidden="true" />
        <span>
          {contextCopy.credentialAvailability[reference.availability]}
        </span>
        {reference.lastCheckedAt ? (
          <time dateTime={reference.lastCheckedAt}>
            {formatDate(reference.lastCheckedAt)}
          </time>
        ) : null}
      </div>
      {reference.lastError && reference.availability !== "unknown" ? (
        <p className="credential-error">{reference.lastError}</p>
      ) : null}
      <footer>
        <button
          type="button"
          disabled={busy || reference.status === "disabled"}
          aria-busy={busy}
          onClick={() => onCheck(reference.id)}
        >
          <RefreshCw
            size={16}
            aria-hidden="true"
            className={busy ? "is-spinning" : ""}
          />
          {contextCopy.checkReference}
        </button>
        <button
          type="button"
          disabled={busy}
          aria-busy={busy}
          onClick={() =>
            onToggle(reference.id, reference.status === "disabled")
          }
        >
          {reference.status === "active"
            ? contextCopy.disableReference
            : contextCopy.enableReference}
        </button>
      </footer>
    </article>
  );
}

function credentialLocator(source: CredentialReferenceSource): string {
  return source.type === "environment"
    ? `ENV · ${source.variable}`
    : `KEYCHAIN · ${source.service} / ${source.account}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}
