import type { ExecuteBrowserTakeoverActionRequest } from "@napier/contracts/browser-takeover";

export function parseBrowserTakeoverActionRequest(
  input: unknown,
): ExecuteBrowserTakeoverActionRequest | undefined {
  if (!record(input)) return undefined;
  const action = input["action"];
  const binding = takeoverBinding(input);
  if (!binding) return undefined;
  if (action === "click") return parseClick(input, binding);
  if (action === "type") return parseType(input, binding);
  if (action === "select") return parseSelect(input, binding);
  if (action === "scroll") return parseScroll(input, binding);
  if (action === "back") return parseBack(input, binding);
  if (action === "wait") return parseWait(input, binding);
  return undefined;
}

type TakeoverBinding = Pick<
  ExecuteBrowserTakeoverActionRequest,
  | "expectedPauseStateSha256"
  | "expectedSessionIdSha256"
  | "expectedSessionOperation"
  | "expectedSnapshotSha256"
>;

const bindingKeys = [
  "expectedPauseStateSha256",
  "expectedSessionIdSha256",
  "expectedSessionOperation",
  "expectedSnapshotSha256",
] as const;

function parseClick(
  input: Record<string, unknown>,
  binding: TakeoverBinding,
): ExecuteBrowserTakeoverActionRequest | undefined {
  if (!exactKeys(input, [...bindingKeys, "action", "ref", "allowCrossOrigin"])) {
    return undefined;
  }
  const ref = takeoverRef(input["ref"]);
  const allowCrossOrigin = input["allowCrossOrigin"];
  return ref &&
    (allowCrossOrigin === undefined || typeof allowCrossOrigin === "boolean")
    ? {
        ...binding,
        action: "click",
        ref,
        ...(allowCrossOrigin === true ? { allowCrossOrigin } : {}),
      }
    : undefined;
}

function parseType(
  input: Record<string, unknown>,
  binding: TakeoverBinding,
): ExecuteBrowserTakeoverActionRequest | undefined {
  if (!exactKeys(input, [...bindingKeys, "action", "ref", "text"])) {
    return undefined;
  }
  const ref = takeoverRef(input["ref"]);
  const text = input["text"];
  return ref &&
    typeof text === "string" &&
    Buffer.byteLength(text, "utf8") <= 8_000
    ? { ...binding, action: "type", ref, text }
    : undefined;
}

function parseSelect(
  input: Record<string, unknown>,
  binding: TakeoverBinding,
): ExecuteBrowserTakeoverActionRequest | undefined {
  if (!exactKeys(input, [...bindingKeys, "action", "ref", "values"])) {
    return undefined;
  }
  const ref = takeoverRef(input["ref"]);
  const values = input["values"];
  return ref &&
    Array.isArray(values) &&
    values.length >= 1 &&
    values.length <= 20 &&
    values.every(
      (value) =>
        typeof value === "string" &&
        Buffer.byteLength(value, "utf8") <= 512,
    )
    ? { ...binding, action: "select", ref, values }
    : undefined;
}

function parseScroll(
  input: Record<string, unknown>,
  binding: TakeoverBinding,
): ExecuteBrowserTakeoverActionRequest | undefined {
  if (!exactKeys(input, [...bindingKeys, "action", "direction", "pixels"])) {
    return undefined;
  }
  const direction = input["direction"];
  const pixels = input["pixels"];
  return (direction === "up" || direction === "down") &&
    (pixels === undefined ||
      (Number.isSafeInteger(pixels) &&
        Number(pixels) >= 1 &&
        Number(pixels) <= 5_000))
    ? {
        ...binding,
        action: "scroll",
        direction,
        ...(pixels !== undefined ? { pixels: Number(pixels) } : {}),
      }
    : undefined;
}

function parseBack(
  input: Record<string, unknown>,
  binding: TakeoverBinding,
): ExecuteBrowserTakeoverActionRequest | undefined {
  if (!exactKeys(input, [...bindingKeys, "action", "allowCrossOrigin"])) {
    return undefined;
  }
  const allowCrossOrigin = input["allowCrossOrigin"];
  return allowCrossOrigin === undefined || typeof allowCrossOrigin === "boolean"
    ? {
        ...binding,
        action: "back",
        ...(allowCrossOrigin === true ? { allowCrossOrigin } : {}),
      }
    : undefined;
}

function parseWait(
  input: Record<string, unknown>,
  binding: TakeoverBinding,
): ExecuteBrowserTakeoverActionRequest | undefined {
  if (!exactKeys(input, [...bindingKeys, "action", "durationMs"])) {
    return undefined;
  }
  const durationMs = input["durationMs"];
  return durationMs === undefined ||
    (Number.isSafeInteger(durationMs) &&
      Number(durationMs) >= 1 &&
      Number(durationMs) <= 10_000)
    ? {
        ...binding,
        action: "wait",
        ...(durationMs !== undefined
          ? { durationMs: Number(durationMs) }
          : {}),
      }
    : undefined;
}

function takeoverBinding(
  input: Record<string, unknown>,
): TakeoverBinding | undefined {
  const pause = input["expectedPauseStateSha256"];
  const session = input["expectedSessionIdSha256"];
  const operation = input["expectedSessionOperation"];
  const snapshot = input["expectedSnapshotSha256"];
  return hash(pause) &&
    hash(session) &&
    Number.isSafeInteger(operation) &&
    Number(operation) >= 0 &&
    hash(snapshot)
    ? {
        expectedPauseStateSha256: pause,
        expectedSessionIdSha256: session,
        expectedSessionOperation: Number(operation),
        expectedSnapshotSha256: snapshot,
      }
    : undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(
  input: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  const keys = new Set(allowed);
  return Object.keys(input).every((key) => keys.has(key));
}

function hash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function takeoverRef(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-z0-9]{1,40}$/u.test(value)
    ? value
    : undefined;
}
