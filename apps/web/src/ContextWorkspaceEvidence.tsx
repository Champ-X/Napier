import { Database, ShieldCheck } from "lucide-react";

import { contextCopy } from "./context-copy";
import { ContextCheckpointCard } from "./ContextCheckpointCard";
import { ContextLedgerRow } from "./ContextLedgerRow";
import { CredentialRegister } from "./CredentialRegister";
import { UsagePriceTableCard } from "./UsagePriceTableCard";
import type { ContextPanelController } from "./use-context-panel-controller";

export interface ContextWorkspaceEvidenceProps {
  controller: ContextPanelController;
}

export function ContextWorkspaceEvidence({
  controller,
}: ContextWorkspaceEvidenceProps) {
  const {
    addCredential,
    canAddCredential,
    checkCredential,
    checkpoint,
    checkpointCalibration,
    configurationBusy,
    credentialBusyId,
    credentialDraft,
    credentials,
    providers,
    selectCredentialProvider,
    toggleCredential,
    updateCredentialDraft,
    usagePriceTableCatalog,
    workspace,
  } = controller;
  return (
    <>
      <CredentialRegister
        providers={providers}
        references={credentials}
        draft={credentialDraft}
        busy={configurationBusy}
        busyReferenceId={credentialBusyId}
        canAdd={canAddCredential}
        onProvider={selectCredentialProvider}
        onDraft={updateCredentialDraft}
        onAdd={() => void addCredential()}
        onCheck={(referenceId) => void checkCredential(referenceId)}
        onToggle={(referenceId, enabled) =>
          void toggleCredential(referenceId, enabled)
        }
      />
      <dl className="context-ledger">
        <ContextLedgerRow
          icon={<Database size={15} />}
          label={contextCopy.workspace}
        >
          <code>{workspace}</code>
        </ContextLedgerRow>
      </dl>
      <UsagePriceTableCard catalog={usagePriceTableCatalog} />
      {checkpoint ? (
        <ContextCheckpointCard
          checkpoint={checkpoint}
          {...(checkpointCalibration
            ? { calibration: checkpointCalibration }
            : {})}
        />
      ) : null}
      <p className="guardrail-note context-guardrail">
        <ShieldCheck size={13} aria-hidden="true" />
        {contextCopy.checkpointSafety}
      </p>
    </>
  );
}
