import type {
  ExecutionPlanWorkflowJavascriptNode,
  JsonValue,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import { MAX_JAVASCRIPT_KERNEL_SESSION_TIMEOUT_MS } from "./javascript-kernel.js";
import {
  MAX_JAVASCRIPT_KERNEL_CODE_BYTES,
  MAX_JAVASCRIPT_KERNEL_EVALUATION_TIMEOUT_MS,
  MAX_JAVASCRIPT_KERNEL_PREVIEW_CHARS,
} from "./javascript-kernel-worker.js";

export const MAX_EXECUTION_PLAN_WORKFLOW_JAVASCRIPT_CELLS = 8;
export const MAX_EXECUTION_PLAN_WORKFLOW_JAVASCRIPT_CODE_BYTES = 32 * 1024;
export const MAX_EXECUTION_PLAN_WORKFLOW_JAVASCRIPT_INPUT_BYTES = 8 * 1024;
export const MAX_EXECUTION_PLAN_WORKFLOW_JAVASCRIPT_OUTPUT_CHARS =
  MAX_JAVASCRIPT_KERNEL_PREVIEW_CHARS;

export function validateWorkflowJavascriptContract(
  input: {
    cells: unknown;
    evaluationTimeoutMs: unknown;
    timeoutMs: unknown;
  },
  label: string,
): Pick<ExecutionPlanWorkflowJavascriptNode, "cells" | "evaluationTimeoutMs"> {
  if (
    !Array.isArray(input.cells) ||
    input.cells.length < 1 ||
    input.cells.length > MAX_EXECUTION_PLAN_WORKFLOW_JAVASCRIPT_CELLS
  ) {
    throw new Error(
      `${label} JavaScript cells must contain 1-${String(MAX_EXECUTION_PLAN_WORKFLOW_JAVASCRIPT_CELLS)} entries`,
    );
  }
  let totalBytes = 0;
  const cells = input.cells.map((cell, index) => {
    if (
      typeof cell !== "string" ||
      cell.length === 0 ||
      Buffer.from(cell, "utf8").toString("utf8") !== cell
    ) {
      throw new Error(
        `${label} JavaScript cell ${String(index + 1)} is invalid`,
      );
    }
    const bytes = Buffer.byteLength(cell, "utf8");
    if (bytes > MAX_JAVASCRIPT_KERNEL_CODE_BYTES) {
      throw new Error(
        `${label} JavaScript cell ${String(index + 1)} exceeds ${String(MAX_JAVASCRIPT_KERNEL_CODE_BYTES)} bytes`,
      );
    }
    totalBytes += bytes;
    return cell;
  });
  if (totalBytes > MAX_EXECUTION_PLAN_WORKFLOW_JAVASCRIPT_CODE_BYTES) {
    throw new Error(
      `${label} JavaScript cells exceed ${String(MAX_EXECUTION_PLAN_WORKFLOW_JAVASCRIPT_CODE_BYTES)} total bytes`,
    );
  }
  if (
    !Number.isSafeInteger(input.evaluationTimeoutMs) ||
    Number(input.evaluationTimeoutMs) < 1 ||
    Number(input.evaluationTimeoutMs) >
      MAX_JAVASCRIPT_KERNEL_EVALUATION_TIMEOUT_MS
  ) {
    throw new Error(`${label} JavaScript evaluationTimeoutMs is invalid`);
  }
  if (
    !Number.isSafeInteger(input.timeoutMs) ||
    Number(input.timeoutMs) > MAX_JAVASCRIPT_KERNEL_SESSION_TIMEOUT_MS
  ) {
    throw new Error(`${label} JavaScript timeoutMs is invalid`);
  }
  return {
    cells,
    evaluationTimeoutMs: Number(input.evaluationTimeoutMs),
  };
}

export function workflowJavascriptConfigurationSha256(
  node: Pick<
    ExecutionPlanWorkflowJavascriptNode,
    "cells" | "evaluationTimeoutMs"
  >,
): string {
  return sha256(
    canonicalJson({
      cells: node.cells,
      evaluationTimeoutMs: node.evaluationTimeoutMs,
    }),
  );
}

export function workflowJavascriptInputBindingCode(input: JsonValue): string {
  const serialized = canonicalJson(input);
  if (
    Buffer.byteLength(serialized, "utf8") >
    MAX_EXECUTION_PLAN_WORKFLOW_JAVASCRIPT_INPUT_BYTES
  ) {
    throw new Error(
      `Workflow JavaScript input exceeds ${String(MAX_EXECUTION_PLAN_WORKFLOW_JAVASCRIPT_INPUT_BYTES)} bytes`,
    );
  }
  const code = [
    'Object.defineProperty(globalThis,"input",{',
    `value:JSON.parse(${JSON.stringify(serialized)}),`,
    "writable:false,configurable:false,enumerable:true",
    "});void 0",
  ].join("");
  if (Buffer.byteLength(code, "utf8") > MAX_JAVASCRIPT_KERNEL_CODE_BYTES) {
    throw new Error("Workflow JavaScript input encoding exceeds its limit");
  }
  return code;
}

export function parseWorkflowJavascriptOutput(
  preview: string,
  previewTruncated: boolean,
): JsonValue {
  if (
    previewTruncated ||
    preview.length > MAX_EXECUTION_PLAN_WORKFLOW_JAVASCRIPT_OUTPUT_CHARS
  ) {
    throw new Error("Workflow JavaScript output preview is truncated");
  }
  let output: unknown;
  try {
    output = JSON.parse(preview);
  } catch {
    throw new Error("Workflow JavaScript output is not JSON");
  }
  canonicalJson(output as JsonValue);
  return structuredClone(output) as JsonValue;
}
