import { formatDeltaMetadata } from "./process-panel-format";
import { workspaceProcessCopy as copy } from "./workspace-process-copy";
import type {
  WorkspaceProcessCardView,
  WorkspaceProcessPanelState,
  WorkspaceProcessSession,
} from "./workspace-process-card-types";

export interface WorkspaceProcessEvidenceProps {
  state: WorkspaceProcessPanelState;
  card: WorkspaceProcessCardView;
  session: WorkspaceProcessSession;
  expanded: boolean;
  deltaExpanded: boolean;
}

export function WorkspaceProcessEvidence({
  state,
  card,
  session,
  expanded,
  deltaExpanded,
}: WorkspaceProcessEvidenceProps) {
  return (
    <>
      {expanded ? <ProcessOutput state={state} /> : null}
      {deltaExpanded && state.delta?.processId === card.id ? (
        <ProcessDelta state={state} session={session} />
      ) : null}
    </>
  );
}

export interface ProcessOutputProps {
  state: WorkspaceProcessPanelState;
}

function ProcessOutput({ state }: ProcessOutputProps) {
  return (
    <div className="process-output">
      <strong>{copy.liveOutput}</strong>
      {!state.selected?.outputAvailable ? (
        <p>{copy.outputUnavailable}</p>
      ) : state.chunks.length === 0 ? (
        <p>{copy.noOutput}</p>
      ) : (
        <pre>
          {state.chunks
            .map((chunk) => `[${chunk.stream} @${chunk.cursor}]\n${chunk.text}`)
            .join("\n")}
        </pre>
      )}
    </div>
  );
}

export interface ProcessDeltaProps {
  state: WorkspaceProcessPanelState;
  session: WorkspaceProcessSession;
}

function ProcessDelta({ state, session }: ProcessDeltaProps) {
  const delta = state.delta!;
  const attribution =
    session.workspaceAccess === "scoped_write"
      ? delta.writeScopeStatus === "within_scope"
        ? copy.scopedDeltaAttribution
        : copy.outsideScopeDelta
      : copy.deltaAttribution;
  return (
    <div className={`process-delta is-${delta.status ?? "unavailable"}`}>
      <strong>{copy.workspaceDelta}</strong>
      {!delta.available ? (
        <p>{copy.deltaUnavailable}</p>
      ) : delta.status === "unchanged" ? (
        <p>{copy.noDelta}</p>
      ) : delta.status === "indeterminate" ? (
        <p>{copy.indeterminateDelta}</p>
      ) : (
        <>
          <p>{attribution}</p>
          <ol>
            {delta.entries.map((entry) => (
              <li key={`${entry.kind}:${entry.path}`}>
                <span>
                  {entry.kind}
                  {entry.entryKind ? ` ${entryKindLabel(entry.entryKind)}` : ""}
                </span>
                <code>{entry.path}</code>
                <small>{formatDeltaMetadata(entry, copy)}</small>
              </li>
            ))}
          </ol>
          {delta.entriesTruncated ? <p>{copy.deltaTruncated}</p> : null}
        </>
      )}
    </div>
  );
}

function entryKindLabel(kind: "directory" | "file" | "symlink"): string {
  return kind === "directory"
    ? copy.deltaDirectory
    : kind === "symlink"
      ? copy.deltaSymlink
      : copy.deltaFile;
}
