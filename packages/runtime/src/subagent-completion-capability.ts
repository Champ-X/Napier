import type { SubagentCompletionCandidate, SubagentCompletionReservation } from "@napier/contracts";
import type { PreparedSubagentCompletion } from "./subagent-completion-types.js";

interface Preparation {
  reservation: SubagentCompletionReservation;
  claimCandidate: (candidate: SubagentCompletionCandidate) => Promise<void>;
}
const prepared = new WeakMap<PreparedSubagentCompletion, Preparation>();

export function createPreparedSubagentCompletion(input: Preparation): PreparedSubagentCompletion {
  const capability = Object.freeze({}) as PreparedSubagentCompletion;
  prepared.set(capability, { ...input, reservation: structuredClone(input.reservation) });
  return capability;
}

export function resolvePreparedSubagentCompletion(value: PreparedSubagentCompletion): Preparation {
  const preparation = prepared.get(value);
  if (!preparation) throw new Error("Subagent completion preparation authority is unavailable");
  return { ...preparation, reservation: structuredClone(preparation.reservation) };
}
