import { RefreshCw, Square, Terminal } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  WorkspaceProcessDelta,
  WorkspaceProcessInputReceipt,
  WorkspaceProcessOutputChunk,
  WorkspaceProcessSession,
} from "@napier/contracts";

import {
  cancelWorkspaceProcess,
  getWorkspaceProcessDelta,
  getWorkspaceProcessOutput,
  listWorkspaceProcesses,
  sendWorkspaceProcessInput,
} from "./workspace-process-api";
import { workspaceProcessCopy as copy } from "./workspace-process-copy";
import {
  appendWorkspaceProcessOutput,
  workspaceProcessCardView,
  workspaceProcessRequestIsCurrent,
  workspaceProcessSelectionRequestIsCurrent,
} from "./workspace-process-view-model";
import { WorkspaceProcessRollback } from "./WorkspaceProcessRollback";

export default function ProcessPanel({
  threadId,
  onThreadChanged,
}: {
  threadId: string;
  onThreadChanged(): void | Promise<void>;
}) {
  const [sessions, setSessions] = useState<WorkspaceProcessSession[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [chunks, setChunks] = useState<WorkspaceProcessOutputChunk[]>([]);
  const [cursor, setCursor] = useState(0);
  const [delta, setDelta] = useState<WorkspaceProcessDelta>();
  const [deltaId, setDeltaId] = useState<string>();
  const [busyId, setBusyId] = useState<string>();
  const [deltaBusyId, setDeltaBusyId] = useState<string>();
  const [error, setError] = useState<string>();
  const [inputDrafts, setInputDrafts] = useState<Record<string, string>>({});
  const [inputBusy, setInputBusy] = useState<{
    processId: string;
    action: "send" | "close";
  }>();
  const [inputReceipt, setInputReceipt] =
    useState<WorkspaceProcessInputReceipt>();
  const activeThreadIdRef = useRef(threadId);
  const loadSequenceRef = useRef(0);
  const outputSequenceRef = useRef(0);
  const selectedIdRef = useRef<string | undefined>(undefined);
  const deltaSequenceRef = useRef(0);
  const deltaIdRef = useRef<string | undefined>(undefined);
  const inputSequenceRef = useRef(0);
  const controllersRef = useRef(new Set<AbortController>());
  activeThreadIdRef.current = threadId;
  selectedIdRef.current = selectedId;
  deltaIdRef.current = deltaId;

  const loadSessions = useCallback(async () => {
    const token = {
      threadId,
      sequence: (loadSequenceRef.current += 1),
    };
    const controller = new AbortController();
    controllersRef.current.add(controller);
    try {
      const next = await listWorkspaceProcesses(threadId, controller.signal);
      if (
        !workspaceProcessRequestIsCurrent(
          token,
          activeThreadIdRef.current,
          loadSequenceRef.current,
        )
      ) {
        return;
      }
      setSessions(next);
      setError(undefined);
    } catch {
      if (
        !controller.signal.aborted &&
        workspaceProcessRequestIsCurrent(
          token,
          activeThreadIdRef.current,
          loadSequenceRef.current,
        )
      ) {
        setError(copy.error);
      }
    } finally {
      controllersRef.current.delete(controller);
    }
  }, [threadId]);

  const loadOutput = useCallback(async () => {
    if (!selectedId) return;
    const token = {
      threadId,
      processId: selectedId,
      sequence: (outputSequenceRef.current += 1),
    };
    const controller = new AbortController();
    controllersRef.current.add(controller);
    try {
      const output = await getWorkspaceProcessOutput(
        threadId,
        selectedId,
        cursor,
        0,
        controller.signal,
      );
      if (
        !workspaceProcessSelectionRequestIsCurrent(
          token,
          activeThreadIdRef.current,
          selectedIdRef.current,
          outputSequenceRef.current,
        )
      ) {
        return;
      }
      setChunks((current) => appendWorkspaceProcessOutput(current, output));
      setCursor((current) => Math.max(current, output.nextCursor));
      setError(undefined);
    } catch {
      if (
        !controller.signal.aborted &&
        workspaceProcessSelectionRequestIsCurrent(
          token,
          activeThreadIdRef.current,
          selectedIdRef.current,
          outputSequenceRef.current,
        )
      ) {
        setError(copy.error);
      }
    } finally {
      controllersRef.current.delete(controller);
    }
  }, [cursor, selectedId, threadId]);

  useEffect(() => {
    setSessions([]);
    setSelectedId(undefined);
    selectedIdRef.current = undefined;
    setChunks([]);
    setCursor(0);
    setDelta(undefined);
    setDeltaId(undefined);
    deltaIdRef.current = undefined;
    setBusyId(undefined);
    setDeltaBusyId(undefined);
    setInputDrafts({});
    setInputBusy(undefined);
    setInputReceipt(undefined);
    void loadSessions();
    return () => {
      loadSequenceRef.current += 1;
      outputSequenceRef.current += 1;
      deltaSequenceRef.current += 1;
      inputSequenceRef.current += 1;
      for (const controller of controllersRef.current) controller.abort();
      controllersRef.current.clear();
    };
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
  const refreshAfterRollback = useCallback(async () => {
    await Promise.all([loadSessions(), onThreadChanged()]);
  }, [loadSessions, onThreadChanged]);
  const toggleOutput = async (session: WorkspaceProcessSession) => {
    if (selectedId === session.id) {
      outputSequenceRef.current += 1;
      selectedIdRef.current = undefined;
      setSelectedId(undefined);
      setChunks([]);
      setCursor(0);
      return;
    }
    const token = {
      threadId,
      processId: session.id,
      sequence: (outputSequenceRef.current += 1),
    };
    const controller = new AbortController();
    controllersRef.current.add(controller);
    selectedIdRef.current = session.id;
    setSelectedId(session.id);
    setChunks([]);
    setCursor(0);
    try {
      const output = await getWorkspaceProcessOutput(
        threadId,
        session.id,
        0,
        0,
        controller.signal,
      );
      if (
        !workspaceProcessSelectionRequestIsCurrent(
          token,
          activeThreadIdRef.current,
          selectedIdRef.current,
          outputSequenceRef.current,
        )
      ) {
        return;
      }
      setChunks(output.chunks);
      setCursor(output.nextCursor);
      setError(undefined);
    } catch {
      if (
        !controller.signal.aborted &&
        workspaceProcessSelectionRequestIsCurrent(
          token,
          activeThreadIdRef.current,
          selectedIdRef.current,
          outputSequenceRef.current,
        )
      ) {
        setError(copy.error);
      }
    } finally {
      controllersRef.current.delete(controller);
    }
  };

  const cancel = async (processId: string) => {
    setBusyId(processId);
    try {
      await cancelWorkspaceProcess(threadId, processId);
      if (activeThreadIdRef.current !== threadId) return;
      await loadSessions();
    } catch {
      if (activeThreadIdRef.current === threadId) setError(copy.error);
    } finally {
      if (activeThreadIdRef.current === threadId) setBusyId(undefined);
    }
  };

  const sendInput = async (processId: string, action: "send" | "close") => {
    const token = {
      threadId,
      sequence: (inputSequenceRef.current += 1),
    };
    const controller = new AbortController();
    controllersRef.current.add(controller);
    setInputBusy({ processId, action });
    setInputReceipt(undefined);
    setError(undefined);
    try {
      const receipt = await sendWorkspaceProcessInput(
        threadId,
        processId,
        action === "send"
          ? {
              text: inputDrafts[processId] ?? "",
              appendNewline: true,
            }
          : { text: "", close: true },
        controller.signal,
      );
      if (
        !workspaceProcessRequestIsCurrent(
          token,
          activeThreadIdRef.current,
          inputSequenceRef.current,
        )
      ) {
        return;
      }
      setInputReceipt(receipt);
      if (action === "send") {
        setInputDrafts((current) => ({ ...current, [processId]: "" }));
      }
      await loadSessions();
    } catch {
      if (
        !controller.signal.aborted &&
        workspaceProcessRequestIsCurrent(
          token,
          activeThreadIdRef.current,
          inputSequenceRef.current,
        )
      ) {
        setError(copy.inputError);
      }
    } finally {
      controllersRef.current.delete(controller);
      if (
        workspaceProcessRequestIsCurrent(
          token,
          activeThreadIdRef.current,
          inputSequenceRef.current,
        )
      ) {
        setInputBusy(undefined);
      }
    }
  };

  const toggleDelta = async (session: WorkspaceProcessSession) => {
    if (deltaId === session.id) {
      deltaSequenceRef.current += 1;
      deltaIdRef.current = undefined;
      setDeltaId(undefined);
      setDelta(undefined);
      setDeltaBusyId(undefined);
      return;
    }
    const token = {
      threadId,
      processId: session.id,
      sequence: (deltaSequenceRef.current += 1),
    };
    const controller = new AbortController();
    controllersRef.current.add(controller);
    deltaIdRef.current = session.id;
    setDeltaId(session.id);
    setDeltaBusyId(session.id);
    try {
      const next = await getWorkspaceProcessDelta(
        threadId,
        session.id,
        controller.signal,
      );
      if (
        !workspaceProcessSelectionRequestIsCurrent(
          token,
          activeThreadIdRef.current,
          deltaIdRef.current,
          deltaSequenceRef.current,
        )
      ) {
        return;
      }
      setDelta(next);
      setError(undefined);
    } catch {
      if (
        controller.signal.aborted ||
        !workspaceProcessSelectionRequestIsCurrent(
          token,
          activeThreadIdRef.current,
          deltaIdRef.current,
          deltaSequenceRef.current,
        )
      ) {
        return;
      }
      deltaIdRef.current = undefined;
      setDeltaId(undefined);
      setDelta(undefined);
      setError(copy.error);
    } finally {
      controllersRef.current.delete(controller);
      if (
        workspaceProcessRequestIsCurrent(
          token,
          activeThreadIdRef.current,
          deltaSequenceRef.current,
        )
      ) {
        setDeltaBusyId(undefined);
      }
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
                  {card.failureRecovery ? (
                    <div>
                      <dt>{copy.failureRecovery}</dt>
                      <dd>
                        {copy.failureRecoveryRestore} ·{" "}
                        {compensationLabel(card.compensationStatus)}
                      </dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>{copy.output}</dt>
                    <dd>{card.outputLabel}</dd>
                  </div>
                  <div>
                    <dt>{copy.stdin}</dt>
                    <dd>
                      {card.stdinLabel}
                      {card.stdinHash ? ` · ${card.stdinHash}` : ""}
                    </dd>
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
                {!card.running ? (
                  <WorkspaceProcessRollback
                    threadId={threadId}
                    session={session}
                    onApplied={refreshAfterRollback}
                  />
                ) : null}
                {card.running && card.stdinState === "open" ? (
                  <form
                    className="process-input"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void sendInput(card.id, "send");
                    }}
                  >
                    <label htmlFor={`process-input-${card.id}`}>
                      {copy.inputLabel}
                    </label>
                    <textarea
                      id={`process-input-${card.id}`}
                      value={inputDrafts[card.id] ?? ""}
                      maxLength={32 * 1024}
                      rows={3}
                      disabled={inputBusy?.processId === card.id}
                      placeholder={copy.inputPlaceholder}
                      onChange={(event) =>
                        setInputDrafts((current) => ({
                          ...current,
                          [card.id]: event.currentTarget.value,
                        }))
                      }
                    />
                    <small>
                      {session.ioMode === "pty"
                        ? copy.ptyInputSafety
                        : copy.inputSafety}
                    </small>
                    <div>
                      <button
                        type="submit"
                        className="secondary-button"
                        disabled={
                          inputBusy?.processId === card.id ||
                          (inputDrafts[card.id] ?? "").length === 0
                        }
                      >
                        {inputBusy?.processId === card.id &&
                        inputBusy.action === "send"
                          ? copy.sendingInput
                          : copy.sendInput}
                      </button>
                      {card.stdinCanClose ? (
                        <button
                          type="button"
                          className="secondary-button danger"
                          disabled={inputBusy?.processId === card.id}
                          onClick={() => void sendInput(card.id, "close")}
                        >
                          {inputBusy?.processId === card.id &&
                          inputBusy.action === "close"
                            ? copy.closingInput
                            : copy.closeInput}
                        </button>
                      ) : null}
                    </div>
                  </form>
                ) : null}
                {inputReceipt?.processId === card.id ? (
                  <span className="process-input-receipt" role="status">
                    {copy.inputReceipt}{" "}
                    {inputReceipt.contentSha256.slice(0, 12)}
                  </span>
                ) : null}
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
                        <p>
                          {session.workspaceAccess === "scoped_write"
                            ? delta.writeScopeStatus === "within_scope"
                              ? copy.scopedDeltaAttribution
                              : copy.outsideScopeDelta
                            : copy.deltaAttribution}
                        </p>
                        <ol>
                          {delta.entries.map((entry) => (
                            <li key={`${entry.kind}:${entry.path}`}>
                              <span>
                                {entry.kind}
                                {entry.entryKind
                                  ? ` ${
                                      entry.entryKind === "directory"
                                        ? copy.deltaDirectory
                                        : entry.entryKind === "symlink"
                                          ? copy.deltaSymlink
                                          : copy.deltaFile
                                    }`
                                  : ""}
                              </span>
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

function compensationLabel(
  status: WorkspaceProcessSession["workspaceCompensationStatus"],
): string {
  if (status === "not_needed") return copy.compensationNotNeeded;
  if (status === "restored") return copy.compensationRestored;
  if (status === "reverted") return copy.compensationReverted;
  if (status === "indeterminate") return copy.compensationIndeterminate;
  if (status === "unavailable") return copy.compensationUnavailable;
  return copy.compensationPending;
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
