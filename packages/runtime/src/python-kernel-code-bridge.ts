import type {
  GovernedCodeBridgeDispatcher,
  GovernedCodeBridgeRequest,
  GovernedCodeBridgeResult,
} from "./governed-code-bridge-model.js";
import {
  formatKernelCodeBridgeResponseFrames,
  MAX_KERNEL_CODE_BRIDGE_FRAME_PAYLOAD_BYTES,
  MAX_KERNEL_CODE_BRIDGE_RESPONSE_FRAMES,
  MAX_KERNEL_CODE_BRIDGE_RESULT_BYTES,
} from "./kernel-code-bridge-framing.js";

export const PYTHON_KERNEL_CALL_PREFIX = "NAPIER_PY_CALL ";
export const PYTHON_KERNEL_CALL_RESULT_PREFIX = "NAPIER_PY_CALL_RESULT ";
export const MAX_PYTHON_KERNEL_BRIDGE_INPUT_BYTES = 32 * 1024;
export const MAX_PYTHON_KERNEL_BRIDGE_RESULT_BYTES =
  MAX_KERNEL_CODE_BRIDGE_RESULT_BYTES;
export const MAX_PYTHON_KERNEL_BRIDGE_FRAME_PAYLOAD_BYTES =
  MAX_KERNEL_CODE_BRIDGE_FRAME_PAYLOAD_BYTES;
export const MAX_PYTHON_KERNEL_BRIDGE_RESPONSE_FRAMES =
  MAX_KERNEL_CODE_BRIDGE_RESPONSE_FRAMES;

export type PythonKernelCodeBridgeRequest = GovernedCodeBridgeRequest;
export type PythonKernelCodeBridgeResult = GovernedCodeBridgeResult;
export type PythonKernelCodeBridgeDispatcher = GovernedCodeBridgeDispatcher;

export function parsePythonKernelCodeBridgeRequest(
  line: string,
  evaluationId: string,
): PythonKernelCodeBridgeRequest | undefined {
  if (!line.startsWith(PYTHON_KERNEL_CALL_PREFIX)) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(line.slice(PYTHON_KERNEL_CALL_PREFIX.length));
  } catch {
    return undefined;
  }
  if (
    !record(value) ||
    value["kind"] !== "napier.python-kernel-call" ||
    value["schemaVersion"] !== 1 ||
    value["evaluationId"] !== evaluationId ||
    !Number.isSafeInteger(value["callId"]) ||
    Number(value["callId"]) < 1 ||
    typeof value["toolId"] !== "string" ||
    !/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u.test(value["toolId"]) ||
    typeof value["inputJson"] !== "string" ||
    Buffer.byteLength(value["inputJson"], "utf8") >
      MAX_PYTHON_KERNEL_BRIDGE_INPUT_BYTES
  ) {
    return undefined;
  }
  let input: unknown;
  try {
    input = JSON.parse(value["inputJson"]);
  } catch {
    return undefined;
  }
  return {
    evaluationId,
    callId: Number(value["callId"]),
    toolId: value["toolId"],
    input,
  };
}

export function formatPythonKernelCodeBridgeResponse(input: {
  evaluationId: string;
  callId: number;
  result?: PythonKernelCodeBridgeResult;
  error?: string;
}): readonly string[] {
  try {
    return formatKernelCodeBridgeResponseFrames({
      prefix: PYTHON_KERNEL_CALL_RESULT_PREFIX,
      kind: "napier.python-kernel-call-result-frame",
      ...input,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Code Bridge result exceeded its limit"
    ) {
      throw new Error("Python Code Bridge result exceeded its limit");
    }
    throw error;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
