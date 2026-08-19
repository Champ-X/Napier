import { useCallback, useRef, useState } from "react";

import { formatApiErrorMessage } from "./api-error";

export interface ReceiptTrustOperationController {
  busyId: string | undefined;
  error: string | undefined;
  setError: (value: string | undefined) => void;
  run: <T>(id: string, action: () => Promise<T>) => Promise<T | undefined>;
}

export function useReceiptTrustOperation(): ReceiptTrustOperationController {
  const [busyId, setBusyId] = useState<string>();
  const [error, setError] = useState<string>();
  const busyRef = useRef<string | undefined>(undefined);
  const run = useCallback(
    async <T>(id: string, action: () => Promise<T>): Promise<T | undefined> => {
      if (busyRef.current) return undefined;
      busyRef.current = id;
      setBusyId(id);
      setError(undefined);
      try {
        return await action();
      } catch (caught) {
        setError(formatApiErrorMessage(caught));
        return undefined;
      } finally {
        busyRef.current = undefined;
        setBusyId(undefined);
      }
    },
    [],
  );
  return { busyId, error, setError, run };
}
