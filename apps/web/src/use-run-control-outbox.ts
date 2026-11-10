import { useEffect, useMemo, useRef, useState } from "react";
import type { ThreadDetail, RunEvent } from "@napier/contracts";
import {
  queueRunControlMessage,
  cancelRunControlMessage,
  listRunControlMessages,
} from "./thread-run-api";
import { ControlOutboxStore } from "./run-control-outbox-store";
import { ControlOutboxActions } from "./run-control-outbox-actions";

export function useRunControlOutbox(input: {
  workspaceKey: string | undefined;
  threadId: string | undefined;
  detail:
    | (Pick<ThreadDetail, "thread" | "runControlMessages"> & {
        events?: RunEvent[];
      })
    | undefined;
}) {
  const [, redraw] = useState(0);
  const [store] = useState(
    () =>
      new ControlOutboxStore(
        () => window.localStorage,
        () => redraw((v) => v + 1),
      ),
  );
  const workspace = useRef({ key: input.workspaceKey, generation: 0 });
  if (workspace.current.key !== input.workspaceKey)
    workspace.current = {
      key: input.workspaceKey,
      generation: workspace.current.generation + 1,
    };
  const generation = workspace.current.generation;
  const actions = useMemo(
    () =>
      input.workspaceKey && input.threadId
        ? new ControlOutboxActions(
            input.workspaceKey,
            input.threadId,
            store,
            {
              queue: queueRunControlMessage,
              cancel: cancelRunControlMessage,
              load: listRunControlMessages,
            },
            () => workspace.current.generation === generation,
            () => redraw((v) => v + 1),
          )
        : undefined,
    [input.workspaceKey, input.threadId, generation, store],
  );
  const entries = actions?.list() ?? [];
  useEffect(() => {
    if (!input.detail || input.detail.thread.id !== input.threadId || !actions)
      return;
    const texts = new Map<string, string>();
    const queuedEvents = new Map(
      input.detail.events
        ?.filter((event) => event.type === "run.control.queued")
        .map((event) => [event.seq, event]),
    );
    for (const message of input.detail.runControlMessages) {
      const event = queuedEvents.get(message.queuedEventSeq);
      if (
        event?.threadId !== input.threadId ||
        event.runId !== message.runId ||
        event.type !== "run.control.queued"
      )
        continue;
      const payload = event.payload as Record<string, unknown>;
      if (
        payload["controlMessageId"] === message.id &&
        typeof payload["text"] === "string"
      )
        texts.set(message.id, payload["text"]);
    }
    void actions
      .observe(input.detail.runControlMessages, texts)
      .catch(() => actions.refresh());
  }, [actions, input.detail, input.threadId]);
  useEffect(() => {
    if (!actions) return;
    let disposed = false;
    let timer: number | undefined;
    const needsRefresh = () =>
      actions
        .list()
        .some(
          (entry) =>
            entry.state === "queued" ||
            entry.state === "uncertain" ||
            entry.cancelRequested,
        );
    const refresh = async (): Promise<void> => {
      try {
        await actions.refresh();
      } catch {
        // Retry after settle while control messages remain pending.
      } finally {
        if (!disposed && needsRefresh()) {
          timer = window.setTimeout(() => void refresh(), 3_000);
        }
      }
    };
    const kick = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      void refresh();
    };
    void refresh();
    window.addEventListener("online", kick);
    window.addEventListener("focus", kick);
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener("online", kick);
      window.removeEventListener("focus", kick);
    };
  }, [actions]);
  return {
    actions,
    entries,
    persistenceUnavailable: Boolean(
      input.workspaceKey &&
      input.threadId &&
      store.persistenceUnavailable(input.workspaceKey, input.threadId),
    ),
  };
}
