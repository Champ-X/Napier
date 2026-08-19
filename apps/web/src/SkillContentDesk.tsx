import { FileCheck, Save, ShieldCheck } from "lucide-react";

import { contextCopy } from "./context-copy";
import { PackageFileAction } from "./PackageFileAction";
import type { SkillContentReceipt } from "./package-management-types";
import { SkillContentReceiptCard } from "./SkillContentReceiptCard";
import "./package-management.css";
import "./skill-package-management.css";

export interface SkillContentDeskProps {
  content: string;
  busy: boolean;
  receipt: SkillContentReceipt | undefined;
  installConfirmed: boolean;
  replacementConfirmed: boolean;
  onContent: (value: string) => void;
  onLoadFile: (file: File) => void;
  onPreview: () => void;
  onApply: () => void;
  onInstallConfirmed: (value: boolean) => void;
  onReplacementConfirmed: (value: boolean) => void;
}

export function SkillContentDesk(props: SkillContentDeskProps) {
  const { content, busy, receipt, onContent } = props;
  const review = receipt?.review;
  const canApply = canApplySkillContent(props);
  return (
    <section
      className="package-desk skill-content-desk"
      aria-labelledby="skill-content-title"
    >
      <header className="context-section-heading">
        <div className="context-section-glyph" aria-hidden="true">
          <FileCheck size={16} />
        </div>
        <div>
          <span>{contextCopy.skillContentEyebrow}</span>
          <h3 id="skill-content-title">{contextCopy.skillContent}</h3>
        </div>
        {review ? (
          <code title={review.reviewSha256}>
            {contextCopy.skillContentActions[review.action]}
          </code>
        ) : null}
      </header>
      <p className="package-desk-body">{contextCopy.skillContentBody}</p>
      <label className="context-field skill-content-editor">
        <span>{contextCopy.skillContentText}</span>
        <textarea
          rows={8}
          value={content}
          disabled={busy}
          placeholder={contextCopy.skillContentPlaceholder}
          onChange={(event) => onContent(event.target.value)}
        />
      </label>
      <SkillContentActions {...props} canApply={canApply} />
      <SkillContentConfirmations {...props} />
      {receipt ? <SkillContentReceiptCard receipt={receipt} /> : null}
    </section>
  );
}

function SkillContentActions({
  busy,
  canApply,
  content,
  onApply,
  onLoadFile,
  onPreview,
}: SkillContentDeskProps & { canApply: boolean }) {
  return (
    <div className="package-actions skill-content-actions">
      <PackageFileAction
        accept=".md,text/markdown,text/plain"
        disabled={busy}
        icon={<FileCheck size={16} aria-hidden="true" />}
        label={contextCopy.skillContentFile}
        onFile={onLoadFile}
      />
      <button
        type="button"
        disabled={busy || content.trim().length === 0}
        aria-busy={busy}
        onClick={onPreview}
      >
        <ShieldCheck size={16} aria-hidden="true" />
        {busy
          ? contextCopy.skillContentWorking
          : contextCopy.skillContentPreview}
      </button>
      <button
        type="button"
        disabled={!canApply}
        aria-busy={busy}
        onClick={onApply}
      >
        <Save size={16} aria-hidden="true" />
        {contextCopy.skillContentApply}
      </button>
    </div>
  );
}

function SkillContentConfirmations(props: SkillContentDeskProps) {
  const {
    busy,
    installConfirmed,
    onInstallConfirmed,
    onReplacementConfirmed,
    receipt,
    replacementConfirmed,
  } = props;
  return (
    <>
      {receipt?.review.action === "install" ? (
        <Confirmation
          checked={installConfirmed}
          disabled={busy}
          label={contextCopy.skillContentConfirmInstall}
          onChange={onInstallConfirmed}
        />
      ) : null}
      {receipt?.review.action === "replace" ? (
        <Confirmation
          checked={replacementConfirmed}
          disabled={busy}
          label={contextCopy.skillContentConfirmReplacement}
          onChange={onReplacementConfirmed}
        />
      ) : null}
    </>
  );
}

function Confirmation({
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

function canApplySkillContent(props: SkillContentDeskProps): boolean {
  const action = props.receipt?.review.action;
  return (
    Boolean(action) &&
    !props.busy &&
    (action !== "install" || props.installConfirmed) &&
    (action !== "replace" || props.replacementConfirmed)
  );
}
