import { requestRecord } from "./http-request-validation.js";

export interface RebindWorkspaceRootRequest {
  root: string;
}

export function parseRebindWorkspaceRootRequest(
  input: unknown,
): RebindWorkspaceRootRequest | undefined {
  const record = requestRecord(input, ["root"]);
  if (!record || typeof record["root"] !== "string") return undefined;
  return { root: record["root"] };
}
