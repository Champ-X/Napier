import type { JsonValue } from "@napier/contracts";

import {
  agentToolInputLedgerProjection,
  agentToolOutputLedgerProjection,
} from "./agent-tool-ledger.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import { toJsonValue } from "./agent-runtime-utils.js";

/** Recovery storage metadata does not extend a Workflow's typed patch output. */
export function workflowToolOutputValue(
  toolName: string,
  details: unknown,
): JsonValue {
  const value = toJsonValue(details);
  if (
    toolName !== "apply_patch" ||
    !value ||
    Array.isArray(value) ||
    typeof value !== "object" ||
    value["kind"] !== "napier.workspace-patch" ||
    value["schemaVersion"] !== 1 ||
    typeof value["recoveryCapsuleSha256"] !== "string"
  )
    return value;
  const { resultSha256, ...content } = value;
  if (sha256(canonicalJson(content)) !== resultSha256) {
    throw new Error("Workflow patch result digest is invalid");
  }
  const { recoveryCapsuleSha256: _capsule, ...output } = content;
  return { ...output, resultSha256: sha256(canonicalJson(output)) };
}

export interface WorkflowToolCallBinding {
  threadId: string;
  planId: string;
  nodeId: string;
  attempt: number;
  inputSha256: string;
}

/** Stable across recovery of the same Workflow node attempt. */
export function workflowToolCallId(binding: WorkflowToolCallBinding): string {
  return `toolcall_${sha256(
    canonicalJson({
      kind: "napier.workflow-tool-call",
      schemaVersion: 1,
      ...binding,
    }),
  ).slice(0, 32)}`;
}

export function workflowToolOutputLedgerProjection(
  toolName: string,
  output: string,
  result: unknown,
): Record<string, JsonValue> {
  const projection = agentToolOutputLedgerProjection(toolName, output, result);
  if (
    projection["outputRedacted"] === true &&
    typeof projection["outputSha256"] === "string" &&
    typeof projection["outputBytes"] === "number"
  ) {
    return {
      ...projection,
      toolOutputRedacted: true,
      toolOutputBytes: projection["outputBytes"],
      toolOutputSha256: projection["outputSha256"],
    };
  }
  if (typeof projection["output"] !== "string") return projection;
  const { output: _output, ...rest } = projection;
  return {
    ...rest,
    toolOutputRedacted: true,
    toolOutputBytes: Buffer.byteLength(output, "utf8"),
    toolOutputSha256: sha256(output),
  };
}

export function workflowToolInputLedgerProjection(
  toolName: string,
  input: JsonValue,
): Record<string, JsonValue> {
  const projection = agentToolInputLedgerProjection(toolName, input);
  if (!Object.hasOwn(projection, "input")) return projection;
  const { input: _input, ...rest } = projection;
  const encoded = canonicalJson(input);
  return {
    ...rest,
    inputRedacted: true,
    inputBytes: Buffer.byteLength(encoded, "utf8"),
    inputSha256: sha256(canonicalJson({ toolName, input })),
  };
}
