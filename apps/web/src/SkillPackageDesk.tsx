import { FileCheck, Save, ShieldCheck } from "lucide-react";

import type {
  ExtensionPublisherTrustAnchor,
  SkillPackageInstallation,
} from "@napier/contracts";

import { contextCopy } from "./context-copy";
import { PackageFileAction } from "./PackageFileAction";
import { PackageSignerFields } from "./PackageSignerFields";
import type { SkillPackageReceipt } from "./package-management-types";
import { SkillPackageReceiptCard } from "./SkillPackageReceiptCard";
import "./package-management.css";
import "./skill-package-management.css";

export interface SkillPackageDeskProps {
  enabledSkills: string[];
  anchors: ExtensionPublisherTrustAnchor[];
  activeInstallation: SkillPackageInstallation | undefined;
  publisher: string;
  selectedAnchorId: string;
  busy: boolean;
  canSign: boolean;
  replacementConfirmed: boolean;
  publisherChangeConfirmed: boolean;
  skillSetChangeConfirmed: boolean;
  receipt: SkillPackageReceipt | undefined;
  onPublisher: (value: string) => void;
  onAnchor: (value: string) => void;
  onReplacementConfirmed: (value: boolean) => void;
  onPublisherChangeConfirmed: (value: boolean) => void;
  onSkillSetChangeConfirmed: (value: boolean) => void;
  onSign: () => void;
  onInspectFile: (file: File, action: "verify" | "qualify" | "install") => void;
}

export function SkillPackageDesk(props: SkillPackageDeskProps) {
  const {
    activeInstallation,
    anchors,
    busy,
    enabledSkills,
    publisher,
    receipt,
    selectedAnchorId,
  } = props;
  return (
    <section
      className="package-desk skill-package-desk"
      aria-labelledby="skill-package-title"
    >
      <header className="context-section-heading">
        <div className="context-section-glyph" aria-hidden="true">
          <ShieldCheck size={16} />
        </div>
        <div>
          <span>{contextCopy.skillPackageEyebrow}</span>
          <h3 id="skill-package-title">{contextCopy.skillPackage}</h3>
        </div>
        <code>{enabledSkills.length}</code>
      </header>
      <p className="package-desk-body">{contextCopy.skillPackageBody}</p>
      {activeInstallation ? (
        <ActiveSkillInstallation installation={activeInstallation} />
      ) : null}
      <PackageSignerFields
        anchors={anchors}
        busy={busy}
        noSignerLabel={contextCopy.skillPackageNoSigner}
        onAnchor={props.onAnchor}
        onPublisher={props.onPublisher}
        publisher={publisher}
        publisherLabel={contextCopy.skillPackagePublisher}
        selectedAnchorId={selectedAnchorId}
        signerLabel={contextCopy.skillPackageSigner}
      />
      <SkillPackageActions {...props} />
      {activeInstallation ? <SkillPackageRiskConfirmations {...props} /> : null}
      {anchors.length === 0 ? (
        <p className="package-note">
          <ShieldCheck size={16} aria-hidden="true" />
          {contextCopy.skillPackageSignerHint}
        </p>
      ) : null}
      {receipt ? <SkillPackageReceiptCard receipt={receipt} /> : null}
    </section>
  );
}

function ActiveSkillInstallation({
  installation,
}: {
  installation: SkillPackageInstallation;
}) {
  return (
    <div className="skill-package-active">
      <span>{contextCopy.skillPackageActive}</span>
      <code title={installation.skillCatalogSha256}>
        {installation.skillCatalogSha256.slice(0, 12)}
      </code>
      <small>{installation.loadedSkillNames.join(", ")}</small>
    </div>
  );
}

function SkillPackageActions({
  busy,
  canSign,
  onInspectFile,
  onSign,
}: SkillPackageDeskProps) {
  return (
    <div className="package-actions skill-package-actions">
      <button
        type="button"
        disabled={busy || !canSign}
        aria-busy={busy}
        onClick={onSign}
      >
        <Save size={16} aria-hidden="true" />
        {busy ? contextCopy.skillPackageWorking : contextCopy.skillSign}
      </button>
      <PackageFileAction
        accept="application/json,.json"
        disabled={busy}
        icon={<ShieldCheck size={16} aria-hidden="true" />}
        label={contextCopy.skillVerify}
        onFile={(file) => onInspectFile(file, "verify")}
      />
      <PackageFileAction
        accept="application/json,.json"
        disabled={busy}
        icon={<FileCheck size={16} aria-hidden="true" />}
        label={contextCopy.skillQualify}
        onFile={(file) => onInspectFile(file, "qualify")}
      />
      <PackageFileAction
        accept="application/json,.json"
        disabled={busy}
        icon={<FileCheck size={16} aria-hidden="true" />}
        label={contextCopy.skillInstall}
        onFile={(file) => onInspectFile(file, "install")}
      />
    </div>
  );
}

function SkillPackageRiskConfirmations(props: SkillPackageDeskProps) {
  return (
    <div className="skill-package-risk-confirmations">
      <RiskConfirmation
        checked={props.replacementConfirmed}
        disabled={props.busy}
        label={contextCopy.skillPackageReplaceConfirm}
        onChange={props.onReplacementConfirmed}
      />
      <RiskConfirmation
        checked={props.publisherChangeConfirmed}
        disabled={props.busy}
        label={contextCopy.skillPackagePublisherChangeConfirm}
        onChange={props.onPublisherChangeConfirmed}
      />
      <RiskConfirmation
        checked={props.skillSetChangeConfirmed}
        disabled={props.busy}
        label={contextCopy.skillPackageSkillSetChangeConfirm}
        onChange={props.onSkillSetChangeConfirmed}
      />
    </div>
  );
}

function RiskConfirmation({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="package-confirmation">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}
