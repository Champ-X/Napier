import type { CreateMemoryRequest, MemoryFact } from "@napier/contracts";
import { useState } from "react";

export function useMemoryProvenanceDraft(
  proposeMemory: (request: CreateMemoryRequest) => Promise<MemoryFact>,
) {
  const [memoryDraft, setMemoryDraft] = useState("");
  const [memoryPersistenceReason, setMemoryPersistenceReason] = useState("");
  const [memoryDifferenceSummary, setMemoryDifferenceSummary] = useState("");
  const reset = (): void => {
    setMemoryPersistenceReason("");
    setMemoryDifferenceSummary("");
  };
  const setDraft = (value: string): void => {
    setMemoryDraft(value);
    if (!value) reset();
  };
  const propose = async (request: CreateMemoryRequest): Promise<MemoryFact> => {
    const fact = await proposeMemory({
      ...request,
      ...(memoryPersistenceReason.trim()
        ? { persistenceReason: memoryPersistenceReason.trim() }
        : {}),
      ...(memoryDifferenceSummary.trim()
        ? { differenceSummary: memoryDifferenceSummary.trim() }
        : {}),
    });
    reset();
    return fact;
  };
  return [
    memoryDraft,
    setDraft,
    {
      memoryPersistenceReason,
      memoryDifferenceSummary,
      setMemoryPersistenceReason,
      setMemoryDifferenceSummary,
      propose,
    },
  ] as const;
}
