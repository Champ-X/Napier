import { FileCheck, Save, ShieldCheck } from "lucide-react";

import type {
  AgentProfile,
  ExtensionPublisherTrustAnchor,
} from "@napier/contracts";

import { contextCopy } from "./context-copy";
import { PackageFileAction } from "./PackageFileAction";
import { PackageSignerFields } from "./PackageSignerFields";
import type { PromptPackageReceipt } from "./package-management-types";
import { PromptPackageReceiptCard } from "./PromptPackageReceiptCard";
import "./package-management.css";

export interface PromptPackageDeskProps {
  agent: AgentProfile;
  anchors: ExtensionPublisherTrustAnchor[];
  publisher: string;
  selectedAnchorId: string;
  busy: boolean;
  canSign: boolean;
  receipt: PromptPackageReceipt | undefined;
  onPublisher: (value: string) => void;
  onAnchor: (value: string) => void;
  onSign: () => void;
  onInspectFile: (file: File, action: "verify" | "qualify") => void;
}

export function PromptPackageDesk({
  agent,
  anchors,
  publisher,
  selectedAnchorId,
  busy,
  canSign,
  receipt,
  onPublisher,
  onAnchor,
  onSign,
  onInspectFile,
}: PromptPackageDeskProps) {
  return (
    <section
      className="package-desk prompt-package-desk"
      aria-labelledby="prompt-package-title"
    >
      <header className="context-section-heading">
        <div className="context-section-glyph" aria-hidden="true">
          <FileCheck size={16} />
        </div>
        <div>
          <span>{contextCopy.promptPackageEyebrow}</span>
          <h3 id="prompt-package-title">{contextCopy.promptPackage}</h3>
        </div>
        <code title={agent.id}>
          {contextCopy.revision} {agent.revision}
        </code>
      </header>
      <p className="package-desk-body">{contextCopy.promptPackageBody}</p>
      <PackageSignerFields
        anchors={anchors}
        busy={busy}
        noSignerLabel={contextCopy.promptPackageNoSigner}
        onAnchor={onAnchor}
        onPublisher={onPublisher}
        publisher={publisher}
        publisherLabel={contextCopy.promptPackagePublisher}
        selectedAnchorId={selectedAnchorId}
        signerLabel={contextCopy.promptPackageSigner}
      />
      <PromptPackageActions
        busy={busy}
        canSign={canSign}
        onSign={onSign}
        onInspectFile={onInspectFile}
      />
      {anchors.length === 0 ? (
        <PackageSignerNote text={contextCopy.promptPackageSignerHint} />
      ) : null}
      {receipt ? <PromptPackageReceiptCard receipt={receipt} /> : null}
    </section>
  );
}

function PromptPackageActions({
  busy,
  canSign,
  onSign,
  onInspectFile,
}: Pick<
  PromptPackageDeskProps,
  "busy" | "canSign" | "onSign" | "onInspectFile"
>) {
  return (
    <div className="package-actions">
      <button
        type="button"
        disabled={busy || !canSign}
        aria-busy={busy}
        onClick={onSign}
      >
        <Save size={16} aria-hidden="true" />
        {busy ? contextCopy.promptPackageWorking : contextCopy.promptSign}
      </button>
      <PackageFileAction
        accept="application/json,.json"
        disabled={busy}
        icon={<ShieldCheck size={16} aria-hidden="true" />}
        label={contextCopy.promptVerify}
        onFile={(file) => onInspectFile(file, "verify")}
      />
      <PackageFileAction
        accept="application/json,.json"
        disabled={busy}
        icon={<FileCheck size={16} aria-hidden="true" />}
        label={contextCopy.promptQualify}
        onFile={(file) => onInspectFile(file, "qualify")}
      />
    </div>
  );
}

function PackageSignerNote({ text }: { text: string }) {
  return (
    <p className="package-note">
      <ShieldCheck size={16} aria-hidden="true" />
      {text}
    </p>
  );
}
