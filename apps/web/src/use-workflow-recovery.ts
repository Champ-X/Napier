import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkflowRecoveryCheckpoint } from "@napier/contracts/workflow-recovery";
import { getWorkflowRecovery, recoverWorkflow } from "./workflow-recovery-api";

export function useWorkflowRecovery(options: {
  workspaceKey: string;
  threadId: string;
  planId: string;
  revision: number;
  eventCount: number;
  running: boolean;
  onSettled(): void | Promise<void>;
}) {
  const identity = JSON.stringify([
    options.workspaceKey,
    options.threadId,
    options.planId,
  ]);
  const current = useRef(identity);
  current.current = identity;
  const alive = useRef(true);
  const inFlight = useRef(false);
  const readGeneration = useRef(0);
  const [checkpoint, setCheckpoint] = useState<WorkflowRecoveryCheckpoint>();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const generation = ++readGeneration.current;
      const valid = () =>
        alive.current &&
        current.current === identity &&
        !signal?.aborted &&
        generation === readGeneration.current;
      if (valid()) setLoading(true);
      try {
        const value = await getWorkflowRecovery(
          options.threadId,
          options.planId,
          signal,
        );
        if (valid()) setCheckpoint(value);
      } catch {
        if (valid()) {
          setCheckpoint(undefined);
          setError(true);
        }
      } finally {
        if (valid()) setLoading(false);
      }
    },
    [identity, options.threadId, options.planId],
  );
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh, options.revision, options.eventCount, options.running]);
  const continueWorkflow = async () => {
    if (
      inFlight.current ||
      options.running ||
      loading ||
      checkpoint?.status !== "ready" ||
      checkpoint.threadId !== options.threadId ||
      checkpoint.planId !== options.planId
    )
      return;
    const valid = () => alive.current && current.current === identity;
    inFlight.current = true;
    setWorking(true);
    setError(false);
    try {
      await recoverWorkflow(checkpoint);
    } catch {
      if (valid()) setError(true);
    } finally {
      // A failed response may still have advanced the Workflow. Reconcile before
      // enabling another action, without writing into a different workspace.
      if (valid()) {
        await Promise.resolve()
          .then(() => {
            if (valid()) return latest.current.onSettled();
          })
          .catch(() => undefined);
        if (valid()) await refresh();
        if (valid()) setWorking(false);
      }
      inFlight.current = false;
    }
  };
  return { checkpoint, working, error, loading, refresh, continueWorkflow };
}
