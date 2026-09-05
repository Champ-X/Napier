import { sha256 } from "./ed25519.js";
import { MAX_WORKSPACE_PROCESS_INPUT_BYTES } from "./workspace-process-input.js";

export const KERNEL_CODE_BRIDGE_RESPONSE_SCHEMA_VERSION = 2;
export const MAX_KERNEL_CODE_BRIDGE_RESULT_BYTES = 256 * 1024;

// Base64 expands by 4/3. Keeping the binary payload at 20 KiB leaves ample
// room for the authenticated routing and integrity metadata while staying
// below the Workspace Process 32 KiB per-write boundary.
export const MAX_KERNEL_CODE_BRIDGE_FRAME_PAYLOAD_BYTES = 20 * 1024;
export const MAX_KERNEL_CODE_BRIDGE_RESPONSE_FRAMES = Math.ceil(
  MAX_KERNEL_CODE_BRIDGE_RESULT_BYTES /
    MAX_KERNEL_CODE_BRIDGE_FRAME_PAYLOAD_BYTES,
);

export interface KernelCodeBridgeResponseFrameInput {
  prefix: string;
  kind: string;
  evaluationId: string;
  callId: number;
  result?: unknown;
  error?: string;
}

/**
 * Formats a bridge response as independently bounded protocol messages.
 *
 * The semantic result is bounded before framing. Each frame repeats the
 * routing identity and whole-payload integrity metadata so a worker can reject
 * mixed, duplicated, reordered, or cross-evaluation fragments.
 */
export function formatKernelCodeBridgeResponseFrames(
  input: KernelCodeBridgeResponseFrameInput,
): readonly string[] {
  const ok = input.result !== undefined;
  const payloadText = ok
    ? JSON.stringify(input.result)
    : (input.error ?? "Code Bridge response is unavailable").slice(0, 1_000);
  if (payloadText === undefined) {
    throw new Error("Code Bridge result must be JSON serializable");
  }
  const payload = Buffer.from(payloadText, "utf8");
  if (payload.byteLength > MAX_KERNEL_CODE_BRIDGE_RESULT_BYTES) {
    throw new Error("Code Bridge result exceeded its limit");
  }

  const frameCount = Math.max(
    1,
    Math.ceil(payload.byteLength / MAX_KERNEL_CODE_BRIDGE_FRAME_PAYLOAD_BYTES),
  );
  const payloadSha256 = sha256(payload);
  const frames: string[] = [];
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const start = frameIndex * MAX_KERNEL_CODE_BRIDGE_FRAME_PAYLOAD_BYTES;
    const chunk = payload.subarray(
      start,
      start + MAX_KERNEL_CODE_BRIDGE_FRAME_PAYLOAD_BYTES,
    );
    const frame = `${input.prefix}${JSON.stringify({
      kind: input.kind,
      schemaVersion: KERNEL_CODE_BRIDGE_RESPONSE_SCHEMA_VERSION,
      evaluationId: input.evaluationId,
      callId: input.callId,
      ok,
      frameIndex,
      frameCount,
      payloadBytes: payload.byteLength,
      payloadSha256,
      payloadEncoding: "base64",
      payloadBase64: chunk.toString("base64"),
    })}`;
    if (
      Buffer.byteLength(`${frame}\n`, "utf8") >=
      MAX_WORKSPACE_PROCESS_INPUT_BYTES
    ) {
      throw new Error("Code Bridge frame exceeded the process message limit");
    }
    frames.push(frame);
  }
  return frames;
}
