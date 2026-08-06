import { useCallback, useEffect, useRef, useState } from "react";

import type { EffectiveAgentCapabilityProjectionV1 } from "@napier/contracts/agent-capability-contract";

import { getAgentCapabilities } from "./agent-capability-api";
import { formatApiErrorMessage } from "./api-error";

export function useAgentCapabilityProjection(
  agentId: string | undefined,
  agentRevision: number | undefined,
) {
  const [projection, setProjection] =
    useState<EffectiveAgentCapabilityProjectionV1>();
  const [loading, setLoading] = useState(Boolean(agentId));
  const [error, setError] = useState<string>();
  const requestSequence = useRef(0);

  const refresh = useCallback(async () => {
    if (!agentId) return undefined;
    const request = ++requestSequence.current;
    setLoading(true);
    setError(undefined);
    try {
      const value = await getAgentCapabilities(agentId);
      if (request === requestSequence.current) setProjection(value);
      return value;
    } catch (reason) {
      if (request === requestSequence.current) {
        setError(formatApiErrorMessage(reason));
      }
      throw reason;
    } finally {
      if (request === requestSequence.current) setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    requestSequence.current += 1;
    setProjection(undefined);
    setError(undefined);
    setLoading(Boolean(agentId));
    if (!agentId) return () => undefined;
    void refresh().catch(() => undefined);
    return () => {
      requestSequence.current += 1;
    };
  }, [agentId, agentRevision, refresh]);

  return { projection, setProjection, refresh, loading, error, setError };
}
