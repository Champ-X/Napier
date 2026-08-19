import type { CredentialReferenceSource } from "@napier/contracts";

import { contextCopy } from "./context-copy";
import type { CredentialDraft } from "./credential-register-types";
import "./credential-register.css";

export interface CredentialDraftFieldsProps {
  providers: readonly string[];
  draft: CredentialDraft;
  busy: boolean;
  onProvider: (providerId: string) => void;
  onDraft: (patch: Partial<CredentialDraft>) => void;
}

export function CredentialDraftFields({
  providers,
  draft,
  busy,
  onProvider,
  onDraft,
}: CredentialDraftFieldsProps) {
  return (
    <>
      <div className="context-field-grid">
        <label className="context-field">
          <span>{contextCopy.provider}</span>
          <select
            value={draft.providerId}
            disabled={busy}
            onChange={(event) => onProvider(event.currentTarget.value)}
          >
            {providers.map((provider) => (
              <option key={provider} value={provider}>
                {provider}
              </option>
            ))}
          </select>
        </label>
        <label className="context-field">
          <span>{contextCopy.source}</span>
          <select
            value={draft.sourceType}
            disabled={busy}
            onChange={(event) =>
              onDraft({
                sourceType: event.currentTarget
                  .value as CredentialReferenceSource["type"],
              })
            }
          >
            <option value="environment">{contextCopy.environment}</option>
            <option value="macos_keychain">{contextCopy.keychain}</option>
          </select>
        </label>
      </div>
      <label className="context-field">
        <span>{contextCopy.referenceLabel}</span>
        <input
          required
          maxLength={100}
          value={draft.label}
          placeholder={contextCopy.referenceLabelPlaceholder}
          disabled={busy}
          onChange={(event) => onDraft({ label: event.currentTarget.value })}
        />
      </label>
      {draft.sourceType === "environment" ? (
        <label className="context-field">
          <span>{contextCopy.environmentVariable}</span>
          <input
            required
            spellCheck={false}
            autoCapitalize="characters"
            pattern="[A-Z_][A-Z0-9_]{1,127}"
            value={draft.environmentVariable}
            placeholder={contextCopy.environmentVariablePlaceholder}
            disabled={busy}
            onChange={(event) =>
              onDraft({
                environmentVariable: event.currentTarget.value.toUpperCase(),
              })
            }
          />
        </label>
      ) : (
        <>
          <div className="context-field-grid">
            <label className="context-field">
              <span>{contextCopy.keychainService}</span>
              <input
                required
                maxLength={200}
                value={draft.keychainService}
                placeholder={contextCopy.keychainServicePlaceholder}
                disabled={busy}
                onChange={(event) =>
                  onDraft({ keychainService: event.currentTarget.value })
                }
              />
            </label>
            <label className="context-field">
              <span>{contextCopy.keychainAccount}</span>
              <input
                required
                maxLength={200}
                value={draft.keychainAccount}
                placeholder={contextCopy.keychainAccountPlaceholder}
                disabled={busy}
                onChange={(event) =>
                  onDraft({ keychainAccount: event.currentTarget.value })
                }
              />
            </label>
          </div>
          <label className="context-field">
            <span>{contextCopy.keychainSecret}</span>
            <input
              type="password"
              minLength={8}
              maxLength={4096}
              value={draft.keychainSecret}
              placeholder={contextCopy.keychainSecretPlaceholder}
              disabled={busy}
              autoComplete="new-password"
              onChange={(event) =>
                onDraft({ keychainSecret: event.currentTarget.value })
              }
            />
          </label>
          <label className="credential-vault-check">
            <input
              type="checkbox"
              checked={draft.replaceExisting}
              disabled={busy}
              onChange={(event) =>
                onDraft({ replaceExisting: event.currentTarget.checked })
              }
            />
            <span>{contextCopy.keychainReplace}</span>
          </label>
        </>
      )}
    </>
  );
}
