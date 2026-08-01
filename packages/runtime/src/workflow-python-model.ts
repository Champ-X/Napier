import type { ExecutionPlanWorkflowPythonNode } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import { MAX_PYTHON_KERNEL_SESSION_TIMEOUT_MS } from "./python-kernel.js";
import {
  MAX_PYTHON_KERNEL_INPUT_BYTES,
  MAX_PYTHON_KERNEL_JSON_VALUE_BYTES,
} from "./python-kernel-json-worker.js";
import {
  MAX_PYTHON_KERNEL_CODE_BYTES,
  MAX_PYTHON_KERNEL_EVALUATION_TIMEOUT_MS,
} from "./python-kernel-worker.js";

export const MAX_EXECUTION_PLAN_WORKFLOW_PYTHON_CELLS = 8;
export const MAX_EXECUTION_PLAN_WORKFLOW_PYTHON_CODE_BYTES = 32 * 1024;
export const MAX_EXECUTION_PLAN_WORKFLOW_PYTHON_INPUT_BYTES =
  MAX_PYTHON_KERNEL_INPUT_BYTES;
export const MAX_EXECUTION_PLAN_WORKFLOW_PYTHON_OUTPUT_BYTES =
  MAX_PYTHON_KERNEL_JSON_VALUE_BYTES;

export function validateWorkflowPythonContract(
  input: {
    cells: unknown;
    evaluationTimeoutMs: unknown;
    timeoutMs: unknown;
  },
  label: string,
): Pick<ExecutionPlanWorkflowPythonNode, "cells" | "evaluationTimeoutMs"> {
  if (
    !Array.isArray(input.cells) ||
    input.cells.length < 1 ||
    input.cells.length > MAX_EXECUTION_PLAN_WORKFLOW_PYTHON_CELLS
  ) {
    throw new Error(
      `${label} Python cells must contain 1-${String(MAX_EXECUTION_PLAN_WORKFLOW_PYTHON_CELLS)} entries`,
    );
  }
  let totalBytes = 0;
  const cells = input.cells.map((cell, index) => {
    if (
      typeof cell !== "string" ||
      cell.length === 0 ||
      Buffer.from(cell, "utf8").toString("utf8") !== cell
    ) {
      throw new Error(`${label} Python cell ${String(index + 1)} is invalid`);
    }
    const bytes = Buffer.byteLength(cell, "utf8");
    if (bytes > MAX_PYTHON_KERNEL_CODE_BYTES) {
      throw new Error(
        `${label} Python cell ${String(index + 1)} exceeds ${String(MAX_PYTHON_KERNEL_CODE_BYTES)} bytes`,
      );
    }
    totalBytes += bytes;
    return cell;
  });
  if (totalBytes > MAX_EXECUTION_PLAN_WORKFLOW_PYTHON_CODE_BYTES) {
    throw new Error(
      `${label} Python cells exceed ${String(MAX_EXECUTION_PLAN_WORKFLOW_PYTHON_CODE_BYTES)} total bytes`,
    );
  }
  if (
    !Number.isSafeInteger(input.evaluationTimeoutMs) ||
    Number(input.evaluationTimeoutMs) < 1 ||
    Number(input.evaluationTimeoutMs) > MAX_PYTHON_KERNEL_EVALUATION_TIMEOUT_MS
  ) {
    throw new Error(`${label} Python evaluationTimeoutMs is invalid`);
  }
  if (
    !Number.isSafeInteger(input.timeoutMs) ||
    Number(input.timeoutMs) > MAX_PYTHON_KERNEL_SESSION_TIMEOUT_MS
  ) {
    throw new Error(`${label} Python timeoutMs is invalid`);
  }
  return {
    cells,
    evaluationTimeoutMs: Number(input.evaluationTimeoutMs),
  };
}

export function workflowPythonConfigurationSha256(
  node: Pick<ExecutionPlanWorkflowPythonNode, "cells" | "evaluationTimeoutMs">,
): string {
  return sha256(
    canonicalJson({
      cells: node.cells,
      evaluationTimeoutMs: node.evaluationTimeoutMs,
    }),
  );
}
