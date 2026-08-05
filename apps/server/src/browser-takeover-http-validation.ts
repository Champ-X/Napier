import {
  BROWSER_TAKEOVER_KEYS,
  type ExecuteBrowserTakeoverActionRequest,
} from "@napier/contracts/browser-takeover";
import {
  BROWSER_LIVE_VIEWPORT_HEIGHT,
  BROWSER_LIVE_VIEWPORT_WIDTH,
} from "@napier/contracts/browser-live-view";

export function parseBrowserTakeoverActionRequest(
  input: unknown,
): ExecuteBrowserTakeoverActionRequest | undefined {
  if (!record(input)) return undefined;
  const action = input["action"];
  const binding = takeoverBinding(input);
  if (!binding) return undefined;
  if (action === "click") return parseClick(input, binding);
  if (action === "visual_click") return parseVisualClick(input, binding);
  if (action === "keypress") return parseKeypress(input, binding);
  if (action === "type") return parseType(input, binding);
  if (action === "select") return parseSelect(input, binding);
  if (action === "scroll") return parseScroll(input, binding);
  if (action === "back") return parseBack(input, binding);
  if (action === "forward") return parseForward(input, binding);
  if (action === "tab_new") return parseTabNew(input, binding);
  if (action === "tab_switch") return parseTabTarget(input, binding, action);
  if (action === "tab_close") return parseTabTarget(input, binding, action);
  if (action === "wait") return parseWait(input, binding);
  return undefined;
}

type TakeoverBinding = Pick<
  ExecuteBrowserTakeoverActionRequest,
  | "expectedPauseStateSha256"
  | "expectedSessionIdSha256"
  | "expectedSessionOperation"
  | "expectedSnapshotSha256"
  | "expectedActiveTabId"
  | "expectedTabCount"
  | "expectedTabSetSha256"
>;

const bindingKeys = [
  "expectedPauseStateSha256",
  "expectedSessionIdSha256",
  "expectedSessionOperation",
  "expectedSnapshotSha256",
  "expectedActiveTabId",
  "expectedTabCount",
  "expectedTabSetSha256",
] as const;

function parseClick(
  input: Record<string, unknown>,
  binding: TakeoverBinding,
): ExecuteBrowserTakeoverActionRequest | undefined {
  if (
    !exactKeys(input, [...bindingKeys, "action", "ref", "allowCrossOrigin"])
  ) {
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

function parseVisualClick(
  input: Record<string, unknown>,
  binding: TakeoverBinding,
): ExecuteBrowserTakeoverActionRequest | undefined {
  if (
    !exactKeys(input, [
      ...bindingKeys,
      "action",
      "expectedLiveImageSha256",
      "expectedViewportWidth",
      "expectedViewportHeight",
      "x",
      "y",
      "allowCrossOrigin",
    ])
  ) {
    return undefined;
  }
  const image = input["expectedLiveImageSha256"];
  const x = input["x"];
  const y = input["y"];
  const allowCrossOrigin = input["allowCrossOrigin"];
  return hash(image) &&
    input["expectedViewportWidth"] === BROWSER_LIVE_VIEWPORT_WIDTH &&
    input["expectedViewportHeight"] === BROWSER_LIVE_VIEWPORT_HEIGHT &&
    Number.isSafeInteger(x) &&
    Number(x) >= 0 &&
    Number(x) < BROWSER_LIVE_VIEWPORT_WIDTH &&
    Number.isSafeInteger(y) &&
    Number(y) >= 0 &&
    Number(y) < BROWSER_LIVE_VIEWPORT_HEIGHT &&
    (allowCrossOrigin === undefined || typeof allowCrossOrigin === "boolean")
    ? {
        ...binding,
        action: "visual_click",
        expectedLiveImageSha256: image,
        expectedViewportWidth: BROWSER_LIVE_VIEWPORT_WIDTH,
        expectedViewportHeight: BROWSER_LIVE_VIEWPORT_HEIGHT,
        x: Number(x),
        y: Number(y),
        ...(allowCrossOrigin === true ? { allowCrossOrigin } : {}),
      }
    : undefined;
}

function parseKeypress(
  input: Record<string, unknown>,
  binding: TakeoverBinding,
): ExecuteBrowserTakeoverActionRequest | undefined {
  if (
    !exactKeys(input, [...bindingKeys, "action", "key", "allowCrossOrigin"])
  ) {
    return undefined;
  }
  const key = input["key"];
  const allowCrossOrigin = input["allowCrossOrigin"];
  return typeof key === "string" &&
    BROWSER_TAKEOVER_KEYS.includes(
      key as (typeof BROWSER_TAKEOVER_KEYS)[number],
    ) &&
    (allowCrossOrigin === undefined || typeof allowCrossOrigin === "boolean")
    ? {
        ...binding,
        action: "keypress",
        key: key as (typeof BROWSER_TAKEOVER_KEYS)[number],
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
        typeof value === "string" && Buffer.byteLength(value, "utf8") <= 512,
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

function parseForward(
  input: Record<string, unknown>,
  binding: TakeoverBinding,
): ExecuteBrowserTakeoverActionRequest | undefined {
  const parsed = parseBack(input, binding);
  return parsed
    ? {
        ...parsed,
        action: "forward",
      }
    : undefined;
}

function parseTabNew(
  input: Record<string, unknown>,
  binding: TakeoverBinding,
): ExecuteBrowserTakeoverActionRequest | undefined {
  if (
    !exactKeys(input, [...bindingKeys, "action", "url", "allowCrossOrigin"])
  ) {
    return undefined;
  }
  const url = publicHttpUrl(input["url"]);
  const allowCrossOrigin = input["allowCrossOrigin"];
  return url &&
    (allowCrossOrigin === undefined || typeof allowCrossOrigin === "boolean")
    ? {
        ...binding,
        action: "tab_new",
        url,
        ...(allowCrossOrigin === true ? { allowCrossOrigin } : {}),
      }
    : undefined;
}

function parseTabTarget(
  input: Record<string, unknown>,
  binding: TakeoverBinding,
  action: "tab_switch" | "tab_close",
): ExecuteBrowserTakeoverActionRequest | undefined {
  if (!exactKeys(input, [...bindingKeys, "action", "tabId"])) {
    return undefined;
  }
  const tabId = takeoverTabId(input["tabId"]);
  return tabId ? { ...binding, action, tabId } : undefined;
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
        ...(durationMs !== undefined ? { durationMs: Number(durationMs) } : {}),
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
  const activeTabId = takeoverTabId(input["expectedActiveTabId"]);
  const tabCount = input["expectedTabCount"];
  const tabSet = input["expectedTabSetSha256"];
  return hash(pause) &&
    hash(session) &&
    Number.isSafeInteger(operation) &&
    Number(operation) >= 0 &&
    hash(snapshot) &&
    activeTabId !== undefined &&
    Number.isSafeInteger(tabCount) &&
    Number(tabCount) >= 1 &&
    Number(tabCount) <= 4 &&
    hash(tabSet)
    ? {
        expectedPauseStateSha256: pause,
        expectedSessionIdSha256: session,
        expectedSessionOperation: Number(operation),
        expectedSnapshotSha256: snapshot,
        expectedActiveTabId: activeTabId,
        expectedTabCount: Number(tabCount),
        expectedTabSetSha256: tabSet,
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

function takeoverTabId(value: unknown): string | undefined {
  return typeof value === "string" && /^tab_[1-9][0-9]{0,3}$/u.test(value)
    ? value
    : undefined;
}

function publicHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length < 1 || value.length > 4_096) {
    return undefined;
  }
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      !parsed.username &&
      !parsed.password
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}
