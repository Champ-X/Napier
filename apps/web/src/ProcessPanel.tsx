import { RefreshCw, Square, Terminal } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  WorkspaceProcessDelta,
  WorkspaceProcessOutputChunk,
  WorkspaceProcessSession,
} from "@napier/contracts";

import {
  cancelWorkspaceProcess,
  getWorkspaceProcessDelta,
  getWorkspaceProcessOutput,
  listWorkspaceProcesses,
} from "./workspace-process-api";
import { workspaceProcessCopy as copy } from "./workspace-process-copy";
import {
  appendWorkspaceProcessOutput,
  workspaceProcessCardView,
} from "./workspace-process-view-model";

export default function ProcessPanel({ threadId }: { threadId: string }) {
  const [sessions, setSessions] = useState<WorkspaceProcessSession[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [chunks, setChunks] = useState<WorkspaceProcessOutputChunk[]>([]);
  const [cursor, setCursor] = useState(0);
  const [delta, setDelta] = useState<WorkspaceProcessDelta>();
  const [deltaId, setDeltaId] = useState<string>();
  const [busyId, setBusyId] = useState<string>();
  const [deltaBusyId, setDeltaBusyId] = useState<string>();
  const [error, setError] = useState<string>();

  const loadSessions = useCallback(async () => {
    try {
      setSessions(await listWorkspaceProcesses(threadId));
      setError(undefined);
    } catch {
      setError(copy.error);
    }
  }, [threadId]);

  const loadOutput = useCallback(async () => {
    if (!selectedId) return;
    try {
      const output = await getWorkspaceProcessOutput(
        threadId,
        selectedId,
        cursor,
      );
      setChunks((current) => appendWorkspaceProcessOutput(current, output));
      setCursor((current) => Math.max(current, output.nextCursor));
      setError(undefined);
    } catch {
      setError(copy.error);
    }
  }, [cursor, selectedId, threadId]);

  useEffect(() => {
    setSessions([]);
    setSelectedId(undefined);
    setChunks([]);
    setCursor(0);
    setDelta(undefined);
    setDeltaId(undefined);
    void loadSessions();
  }, [loadSessions]);

  const hasRunning = sessions.some((session) => session.status === "running");
  const selected = sessions.find((session) => session.id === selectedId);
  useEffect(() => {
    if (!hasRunning) return;
    const timer = window.setInterval(() => {
      void loadSessions();
      if (selected?.status === "running") void loadOutput();
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [hasRunning, loadOutput, loadSessions, selected?.status]);

  const cards = useMemo(
    () => sessions.map((session) => workspaceProcessCardView(session)),
    [sessions],
  );
  const toggleOutput = async (session: WorkspaceProcessSession) => {
    if (selectedId === session.id) {
      setSelectedId(undefined);
      setChunks([]);
      setCursor(0);
      return;
    }
    setSelectedId(session.id);
    setChunks([]);
    setCursor(0);
    try {
      const output = await getWorkspaceProcessOutput(threadId, session.id, 0);
      setChunks(output.chunks);
      setCursor(output.nextCursor);
      setError(undefined);
    } catch {
      setError(copy.error);
    }
  };

  const cancel = async (processId: string) => {
    setBusyId(processId);
    try {
      await cancelWorkspaceProcess(threadId, processId);
      await loadSessions();
    } catch {
      setError(copy.error);
    } finally {
      setBusyId(undefined);
    }
  };

  const toggleDelta = async (session: WorkspaceProcessSession) => {
    if (deltaId === session.id) {
      setDeltaId(undefined);
      setDelta(undefined);
      return;
    }
    setDeltaId(session.id);
    setDeltaBusyId(session.id);
    try {
      const next = await getWorkspaceProcessDelta(threadId, session.id);
      setDelta(next);
      setError(undefined);
    } catch {
      setDeltaId(undefined);
      setDelta(undefined);
      setError(copy.error);
    } finally {
      setDeltaBusyId(undefined);
    }
  };

  return (
    <section
      className="panel-section process-panel"
      aria-labelledby="process-panel-title"
    >
      <div className="panel-heading">
        <div>
          <span>{copy.eyebrow}</span>
          <h3 id="process-panel-title">{copy.title}</h3>
        </div>
        <button
          className="icon-button"
          type="button"
          onClick={() => void loadSessions()}
          aria-label={copy.refresh}
          title={copy.refresh}
        >
          <RefreshCw size={14} aria-hidden="true" />
        </button>
      </div>
      <p className="quiet-copy">{copy.description}</p>
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
      {cards.length === 0 ? (
        <p className="empty-panel">{copy.noSessions}</p>
      ) : (
        <div className="process-list">
          {cards.map((card) => {
            const session = sessions.find(
              (candidate) => candidate.id === card.id,
            )!;
            const expanded = selectedId === card.id;
            const deltaExpanded = deltaId === card.id;
            return (
              <article className="process-card" key={card.id}>
                <header>
                  <Terminal size={15} aria-hidden="true" />
                  <div>
                    <strong>{card.id}</strong>
                    <span>{card.runtimeLabel}</span>
                  </div>
                  <span
                    className={`process-status is-${card.status}`}
                    role="status"
                  >
                    {card.statusLabel}
                  </span>
                </header>
                <dl>
                  <div>
                    <dt>{copy.scope}</dt>
                    <dd>{card.scopeLabel}</dd>
                  </div>
                  <div>
                    <dt>{copy.limits}</dt>
                    <dd>{card.limitLabel}</dd>
                  </div>
                  <div>
                    <dt>{copy.output}</dt>
                    <dd>{card.outputLabel}</dd>
                  </div>
                  <div
                    className={`process-delta-summary is-${card.workspaceDeltaState}`}
                  >
                    <dt>{copy.workspaceDelta}</dt>
                    <dd>{card.workspaceDeltaLabel}</dd>
                  </div>
                  <div>
                    <dt>{copy.commandHash}</dt>
                    <dd>{card.commandHash}</dd>
                  </div>
                  <div>
                    <dt>{copy.started}</dt>
                    <dd>{formatDate(card.startedAt)}</dd>
                  </div>
                  <div>
                    <dt>{copy.duration}</dt>
                    <dd>{card.durationLabel}</dd>
                  </div>
                  {card.settledAt ? (
                    <div>
                      <dt>{copy.settled}</dt>
                      <dd>{formatDate(card.settledAt)}</dd>
                    </div>
                  ) : null}
                  {card.resultHashes ? (
                    <div>
                      <dt>{copy.outputHashes}</dt>
                      <dd>{card.resultHashes}</dd>
                    </div>
                  ) : null}
                  {card.workspaceDeltaHashes ? (
                    <div>
                      <dt>{copy.deltaHashes}</dt>
                      <dd>{card.workspaceDeltaHashes}</dd>
                    </div>
                  ) : null}
                </dl>
                {card.interruptionReason ? (
                  <p className="process-interruption">
                    {card.interruptionReason}
                  </p>
                ) : null}
                <div className="process-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void toggleOutput(session)}
                    aria-expanded={expanded}
                  >
                    {expanded ? copy.hideOutput : copy.showOutput}
                  </button>
                  {!card.running ? (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={deltaBusyId === card.id}
                      onClick={() => void toggleDelta(session)}
                      aria-expanded={deltaExpanded}
                    >
                      {deltaExpanded ? copy.hideDelta : copy.showDelta}
                    </button>
                  ) : null}
                  {card.running ? (
                    <button
                      type="button"
                      className="secondary-button danger"
                      disabled={busyId === card.id}
                      onClick={() => void cancel(card.id)}
                    >
                      <Square size={12} aria-hidden="true" />
                      {busyId === card.id ? copy.cancelling : copy.cancel}
                    </button>
                  ) : null}
                </div>
                {expanded ? (
                  <div className="process-output">
                    <strong>{copy.liveOutput}</strong>
                    {!selected?.outputAvailable ? (
                      <p>{copy.outputUnavailable}</p>
                    ) : chunks.length === 0 ? (
                      <p>{copy.noOutput}</p>
                    ) : (
                      <pre>
                        {chunks
                          .map(
                            (chunk) =>
                              `[${chunk.stream} @${chunk.cursor}]\n${chunk.text}`,
                          )
                          .join("\n")}
                      </pre>
                    )}
                  </div>
                ) : null}
                {deltaExpanded && delta?.processId === card.id ? (
                  <div
                    className={`process-delta is-${delta.status ?? "unavailable"}`}
                  >
                    <strong>{copy.workspaceDelta}</strong>
                    {!delta.available ? (
                      <p>{copy.deltaUnavailable}</p>
                    ) : delta.status === "unchanged" ? (
                      <p>{copy.noDelta}</p>
                    ) : delta.status === "indeterminate" ? (
                      <p>{copy.indeterminateDelta}</p>
                    ) : (
                      <>
                        <p>{copy.deltaAttribution}</p>
                        <ol>
                          {delta.entries.map((entry) => (
                            <li key={`${entry.kind}:${entry.path}`}>
                              <span>{entry.kind}</span>
                              <code>{entry.path}</code>
                              <small>{formatDeltaMetadata(entry, copy)}</small>
                            </li>
                          ))}
                        </ol>
                        {delta.entriesTruncated ? (
                          <p>{copy.deltaTruncated}</p>
                        ) : null}
                      </>
                    )}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function formatDeltaMetadata(
  entry: WorkspaceProcessDelta["entries"][number],
  labels: Pick<
    typeof copy,
    "beforeHash" | "afterHash" | "beforeSize" | "afterSize"
  >,
): string {
  return [
    ...(entry.beforeSha256
      ? [`${labels.beforeHash} ${entry.beforeSha256.slice(0, 12)}`]
      : []),
    ...(entry.afterSha256
      ? [`${labels.afterHash} ${entry.afterSha256.slice(0, 12)}`]
      : []),
    ...(entry.beforeSizeBytes !== undefined
      ? [`${labels.beforeSize} ${entry.beforeSizeBytes.toLocaleString()}`]
      : []),
    ...(entry.afterSizeBytes !== undefined
      ? [`${labels.afterSize} ${entry.afterSizeBytes.toLocaleString()}`]
      : []),
  ].join(" · ");
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}
