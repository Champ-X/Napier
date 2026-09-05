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

export const JAVASCRIPT_KERNEL_CALL_PREFIX = "NAPIER_JS_CALL ";
export const JAVASCRIPT_KERNEL_CALL_RESULT_PREFIX = "NAPIER_JS_CALL_RESULT ";
export const MAX_JAVASCRIPT_KERNEL_BRIDGE_INPUT_BYTES = 32 * 1024;
export const MAX_JAVASCRIPT_KERNEL_BRIDGE_RESULT_BYTES =
  MAX_KERNEL_CODE_BRIDGE_RESULT_BYTES;
export const MAX_JAVASCRIPT_KERNEL_BRIDGE_FRAME_PAYLOAD_BYTES =
  MAX_KERNEL_CODE_BRIDGE_FRAME_PAYLOAD_BYTES;
export const MAX_JAVASCRIPT_KERNEL_BRIDGE_RESPONSE_FRAMES =
  MAX_KERNEL_CODE_BRIDGE_RESPONSE_FRAMES;

export type JavascriptKernelCodeBridgeRequest = GovernedCodeBridgeRequest;
export type JavascriptKernelCodeBridgeResult = GovernedCodeBridgeResult;
export type JavascriptKernelCodeBridgeDispatcher = GovernedCodeBridgeDispatcher;

export function parseJavascriptKernelCodeBridgeRequest(
  line: string,
  evaluationId: string,
): JavascriptKernelCodeBridgeRequest | undefined {
  if (!line.startsWith(JAVASCRIPT_KERNEL_CALL_PREFIX)) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(line.slice(JAVASCRIPT_KERNEL_CALL_PREFIX.length));
  } catch {
    return undefined;
  }
  if (
    !record(value) ||
    value["kind"] !== "napier.javascript-kernel-call" ||
    value["schemaVersion"] !== 1 ||
    value["evaluationId"] !== evaluationId ||
    !Number.isSafeInteger(value["callId"]) ||
    Number(value["callId"]) < 1 ||
    typeof value["toolId"] !== "string" ||
    !/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u.test(value["toolId"]) ||
    typeof value["inputJson"] !== "string" ||
    Buffer.byteLength(value["inputJson"], "utf8") >
      MAX_JAVASCRIPT_KERNEL_BRIDGE_INPUT_BYTES
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

export function formatJavascriptKernelCodeBridgeResponse(input: {
  evaluationId: string;
  callId: number;
  result?: JavascriptKernelCodeBridgeResult;
  error?: string;
}): readonly string[] {
  try {
    return formatKernelCodeBridgeResponseFrames({
      prefix: JAVASCRIPT_KERNEL_CALL_RESULT_PREFIX,
      kind: "napier.javascript-kernel-call-result-frame",
      ...input,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Code Bridge result exceeded its limit"
    ) {
      throw new Error("JavaScript Code Bridge result exceeded its limit");
    }
    throw error;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
