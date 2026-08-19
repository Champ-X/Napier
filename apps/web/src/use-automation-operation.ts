import { useCallback, useRef, useState } from "react";

import { formatApiErrorMessage } from "./api-error";

export interface AutomationOperationResult<T> {
  ok: boolean;
  value?: T;
}

export interface AutomationOperationController {
  busyId: string | undefined;
  error: string | undefined;
  setError: (message: string | undefined) => void;
  run: <T>(
    operationId: string,
    action: () => Promise<T>,
  ) => Promise<AutomationOperationResult<T>>;
}

export function useAutomationOperation(): AutomationOperationController {
  const [busyId, setBusyId] = useState<string>();
  const [error, setError] = useState<string>();
  const busyRef = useRef<string | undefined>(undefined);
  const run = useCallback(
    async <T>(
      operationId: string,
      action: () => Promise<T>,
    ): Promise<AutomationOperationResult<T>> => {
      if (busyRef.current) return { ok: false };
      busyRef.current = operationId;
      setBusyId(operationId);
      setError(undefined);
      try {
        return { ok: true, value: await action() };
      } catch (caught) {
        setError(formatApiErrorMessage(caught));
        return { ok: false };
      } finally {
        busyRef.current = undefined;
        setBusyId(undefined);
      }
    },
    [],
  );
  return { busyId, error, setError, run };
}
