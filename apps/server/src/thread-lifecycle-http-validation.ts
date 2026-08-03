import type {
  CreateThreadRequest,
  ImportThreadReplayBundleRequest,
  SetGoalRequest,
  ThreadReplayBundle,
} from "@napier/contracts";

import { requestRecord } from "./http-request-validation.js";

export function normalizeThreadTitle(title?: string): string {
  const normalized = title?.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 100) : "Untitled ledger";
}

export function parseImportThreadReplayBundleRequest(
  input: unknown,
): ImportThreadReplayBundleRequest | undefined {
  const record = requestRecord(input, ["bundle", "title"]);
  if (!record || record["bundle"] === undefined) return undefined;
  const title = normalizedOptionalTitle(record["title"]);
  if (record["title"] !== undefined && title === undefined) return undefined;
  return {
    bundle: record["bundle"] as ThreadReplayBundle,
    ...(title ? { title } : {}),
  };
}

export function parseCreateThreadRequest(
  input: unknown,
): CreateThreadRequest | undefined {
  if (input === undefined) return {};
  const record = requestRecord(input, ["title", "agentId"]);
  if (!record) return undefined;
  const title = normalizedOptionalTitle(record["title"]);
  if (record["title"] !== undefined && title === undefined) return undefined;
  const agentId = record["agentId"];
  if (
    agentId !== undefined &&
    (typeof agentId !== "string" || !/^agent_[a-z0-9_]{2,80}$/u.test(agentId))
  ) {
    return undefined;
  }
  return {
    ...(title ? { title } : {}),
    ...(typeof agentId === "string" ? { agentId } : {}),
  };
}

export function parseSetGoalRequest(
  input: unknown,
): SetGoalRequest | undefined {
  const record = requestRecord(input, ["objective", "maxContinuations"]);
  const objective =
    typeof record?.["objective"] === "string"
      ? record["objective"].replace(/\s+/g, " ").trim()
      : undefined;
  const maxContinuations = record?.["maxContinuations"];
  if (
    !objective ||
    objective.length > 4_000 ||
    (maxContinuations !== undefined &&
      (!Number.isInteger(maxContinuations) ||
        Number(maxContinuations) < 0 ||
        Number(maxContinuations) > 8))
  ) {
    return undefined;
  }
  return {
    objective,
    ...(typeof maxContinuations === "number" ? { maxContinuations } : {}),
  };
}

function normalizedOptionalTitle(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized && normalized.length <= 100 ? normalized : undefined;
}
