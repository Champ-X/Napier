import { KeyRound, Plus, ShieldCheck } from "lucide-react";

import type { CredentialReference } from "@napier/contracts";

import { contextCopy } from "./context-copy";
import { CredentialCard } from "./CredentialCard";
import { CredentialDraftFields } from "./CredentialDraftFields";
import type { CredentialDraft } from "./credential-register-types";
import "./credential-register.css";

export interface CredentialRegisterProps {
  providers: readonly string[];
  references: readonly CredentialReference[];
  draft: CredentialDraft;
  busy: boolean;
  busyReferenceId: string | undefined;
  canAdd: boolean;
  onProvider: (providerId: string) => void;
  onDraft: (patch: Partial<CredentialDraft>) => void;
  onAdd: () => void;
  onCheck: (referenceId: string) => void;
  onToggle: (referenceId: string, enabled: boolean) => void;
}

export function CredentialRegister({
  providers,
  references,
  draft,
  busy,
  busyReferenceId,
  canAdd,
  onProvider,
  onDraft,
  onAdd,
  onCheck,
  onToggle,
}: CredentialRegisterProps) {
  const safetyId = "credential-register-safety";
  return (
    <section
      className="credential-register"
      aria-labelledby="credential-register-title"
      aria-busy={busy}
    >
      <header className="context-section-heading">
        <div className="context-section-glyph" aria-hidden="true">
          <KeyRound size={16} />
        </div>
        <div>
          <span>{contextCopy.credentialsEyebrow}</span>
          <h3 id="credential-register-title">{contextCopy.credentials}</h3>
        </div>
        <span className="credential-count">
          {references.length.toString().padStart(2, "0")}
        </span>
      </header>
      <form
        className="credential-compose"
        aria-describedby={safetyId}
        onSubmit={(event) => {
          event.preventDefault();
          onAdd();
        }}
      >
        <CredentialDraftFields
          providers={providers}
          draft={draft}
          busy={busy}
          onProvider={onProvider}
          onDraft={onDraft}
        />
        <button
          className="credential-add"
          type="submit"
          disabled={busy || !canAdd}
          aria-busy={busy}
        >
          <Plus size={16} aria-hidden="true" />
          {contextCopy.addReference}
        </button>
        <p className="credential-safety" id={safetyId}>
          <ShieldCheck size={16} aria-hidden="true" />
          {contextCopy.credentialSafety}
        </p>
      </form>
      {references.length === 0 ? (
        <p className="empty-panel">{contextCopy.noCredentials}</p>
      ) : (
        <div className="credential-list">
          {references.map((reference) => (
            <CredentialCard
              key={reference.id}
              reference={reference}
              busy={busyReferenceId === reference.id}
              onCheck={onCheck}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </section>
  );
}
