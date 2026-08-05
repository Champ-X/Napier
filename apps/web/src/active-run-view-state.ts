import type { ThreadDetail } from "@napier/contracts";

export interface ActiveRunViewState {
  activeRunId: string | undefined;
  isRunning: boolean;
}

export function activeRunViewState(
  detail: Pick<ThreadDetail, "thread" | "runs"> | undefined,
): ActiveRunViewState {
  if (!detail) return { activeRunId: undefined, isRunning: false };
  const currentRunId = detail?.thread.currentRunId;
  const running =
    currentRunId === undefined
      ? undefined
      : detail.runs.find(
          (run) => run.id === currentRunId && run.status === "running",
        );
  return {
    activeRunId: running?.id,
    isRunning: running !== undefined,
  };
}
