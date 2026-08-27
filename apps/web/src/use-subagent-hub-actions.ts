import type { SubagentMessageKind } from "@napier/contracts";
import type { LiveReadyBootstrapResponse } from "@napier/contracts/default-run-model";
import type {
  SubagentHubActionResponseV1,
  SubagentHubProjectionV1,
} from "@napier/contracts/subagent-hub";
import {
  useCallback,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import type { WebThreadDetail } from "./api";
import {
  cancelSubagentHubTask,
  reviveSubagentHubTask,
  steerSubagentHubTask,
} from "./subagent-api";

export interface SubagentHubActionBusy {
  action: "steer" | "cancel" | "revive";
  taskId: string;
}

export interface SubagentHubActionFailure {
  taskId: string;
  message: string;
}

interface SubagentHubActionDependencies {
  detail: WebThreadDetail | undefined;
  detailCache: { current: Map<string, WebThreadDetail> };
  selectedThreadId: { current: string | undefined };
  setBootstrap: Dispatch<
    SetStateAction<LiveReadyBootstrapResponse | undefined>
  >;
  setDetail: Dispatch<SetStateAction<WebThreadDetail | undefined>>;
  errorMessage(error: unknown): string;
}

export function useSubagentHubActions({
  detail,
  detailCache,
  selectedThreadId,
  setBootstrap,
  setDetail,
  errorMessage,
}: SubagentHubActionDependencies) {
  const [busy, setBusy] = useState<SubagentHubActionBusy>();
  const [error, setError] = useState<SubagentHubActionFailure>();
  const commit = useCallback(
    (threadId: string, hub: SubagentHubProjectionV1): void => {
      const cached = detailCache.current.get(threadId);
      if (cached)
        detailCache.current.set(threadId, { ...cached, subagentHub: hub });
      setBootstrap((current) =>
        current?.activeThread?.thread.id === threadId
          ? {
              ...current,
              activeThread: { ...current.activeThread, subagentHub: hub },
            }
          : current,
      );
      if (selectedThreadId.current === threadId) {
        setDetail((current) =>
          current?.thread.id === threadId
            ? { ...current, subagentHub: hub }
            : current,
        );
      }
    },
    [detailCache, selectedThreadId, setBootstrap, setDetail],
  );
  const run = useCallback(
    async (
      pending: SubagentHubActionBusy,
      action: () => Promise<SubagentHubActionResponseV1>,
    ): Promise<SubagentHubActionResponseV1 | undefined> => {
      setBusy(pending);
      setError(undefined);
      try {
        const response = await action();
        commit(response.hub.threadId, response.hub);
        return response;
      } catch (actionError) {
        setError({
          taskId: pending.taskId,
          message: errorMessage(actionError),
        });
      } finally {
        setBusy(undefined);
      }
    },
    [commit, errorMessage],
  );

  const steer = useCallback(
    (
      taskId: string,
      revision: number,
      messageKind: SubagentMessageKind,
      text: string,
    ) => {
      if (!detail) return Promise.resolve(undefined);
      return run({ action: "steer", taskId }, () =>
        steerSubagentHubTask(detail.thread.id, taskId, {
          kind: "napier.subagent-hub-steer-request",
          schemaVersion: 1,
          expectedTaskRevision: revision,
          messageKind,
          text,
        }),
      );
    },
    [detail, run],
  );
  const cancel = useCallback(
    (taskId: string, revision: number, reason: string) => {
      if (!detail) return Promise.resolve(undefined);
      return run({ action: "cancel", taskId }, () =>
        cancelSubagentHubTask(detail.thread.id, taskId, {
          kind: "napier.subagent-hub-cancel-request",
          schemaVersion: 1,
          expectedTaskRevision: revision,
          reason,
        }),
      );
    },
    [detail, run],
  );
  const revive = useCallback(
    (taskId: string, revision: number) => {
      if (!detail) return Promise.resolve(undefined);
      return run({ action: "revive", taskId }, () =>
        reviveSubagentHubTask(detail.thread.id, taskId, {
          kind: "napier.subagent-hub-revive-request",
          schemaVersion: 1,
          expectedTaskRevision: revision,
        }),
      );
    },
    [detail, run],
  );

  return {
    subagentHubActionBusy: busy,
    subagentHubActionError: error,
    steerSubagent: steer,
    cancelSubagent: cancel,
    reviveSubagent: revive,
  };
}
