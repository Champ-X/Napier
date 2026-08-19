import { RotateCcw } from "lucide-react";

import type { AgentProfile, AgentProfileRevision } from "@napier/contracts";

import { agentProfileDelta } from "./agent-profile-delta";
import { contextCopy } from "./context-copy";
import "./agent-revision-shared.css";
import "./agent-revision-card.css";

export interface AgentRevisionCardProps {
  current: AgentProfile;
  revision: AgentProfileRevision;
  busy: boolean;
  onReviewRollback: (revision: AgentProfileRevision) => void;
}

export function AgentRevisionCard({
  current,
  revision,
  busy,
  onReviewRollback,
}: AgentRevisionCardProps) {
  const isCurrent = revision.revision === current.revision;
  const restoreFields = agentProfileDelta(current, revision.profile);
  return (
    <article
      className={`agent-revision-card${isCurrent ? " is-current" : ""}`}
    >
      <header>
        <div>
          <span>{contextCopy.revision} {revision.revision}</span>
          <h4>{revision.profile.name}</h4>
        </div>
        <strong>
          {isCurrent
            ? contextCopy.currentRevision
            : contextCopy.revisionSources[revision.source]}
        </strong>
      </header>
      <dl>
        <div>
          <dt>{contextCopy.chooseModel}</dt>
          <dd>{revision.profile.model.provider}/{revision.profile.model.id}</dd>
        </div>
        <div>
          <dt>{contextCopy.policy}</dt>
          <dd>{contextCopy.policies[revision.profile.toolPolicy]}</dd>
        </div>
      </dl>
      <p className="agent-revision-recovery">
        {contextCopy.recoveryShort} ·{" "}
        {contextCopy.recoveryModes[revision.profile.automaticRecovery?.mode ?? "manual"]}
      </p>
      <div className="agent-revision-fields">
        {revision.changedFields.length > 0 ? (
          revision.changedFields.map((field) => (
            <span key={field}>{contextCopy.profileFields[field]}</span>
          ))
        ) : (
          <span>{contextCopy.legacyBaseline}</span>
        )}
      </div>
      {revision.restoredFromRevision !== undefined ? (
        <p>
          {contextCopy.restoredFrom} {contextCopy.revision}{" "}
          {revision.restoredFromRevision}
        </p>
      ) : null}
      <div className="agent-revision-evidence">
        <code title={revision.contentSha256}>
          {contextCopy.profileDigest} {revision.contentSha256.slice(0, 12)}
        </code>
        <code title={revision.systemPromptSha256}>
          {contextCopy.promptDigest} {revision.systemPromptSha256.slice(0, 12)}
        </code>
        <time dateTime={revision.createdAt}>{formatDateTime(revision.createdAt)}</time>
      </div>
      <button
        type="button"
        disabled={busy || isCurrent || restoreFields.length === 0}
        onClick={() => onReviewRollback(revision)}
      >
        <RotateCcw size={14} aria-hidden="true" />
        {contextCopy.reviewRollback}
      </button>
    </article>
  );
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
