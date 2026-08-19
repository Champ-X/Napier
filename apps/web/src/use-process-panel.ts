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

export interface UseProcessPanelOptions {
  threadId: string;
  onThreadChanged(): void | Promise<void>;
}

export function useProcessPanel({
  threadId,
  onThreadChanged,
}: UseProcessPanelOptions) {
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

  return {
    threadId,
    sessions,
    selected,
    cards,
    selectedId,
    chunks,
    delta,
    deltaId,
    busyId,
    deltaBusyId,
    error,
    inputDrafts,
    setInputDrafts,
    inputBusy,
    inputReceipt,
    loadSessions,
    refreshAfterRollback,
    toggleOutput,
    cancel,
    sendInput,
    toggleDelta,
  };
}
