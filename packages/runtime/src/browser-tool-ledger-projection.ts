import type { JsonValue } from "@napier/contracts";
import type { BrowserInteractionConfirmationPreview } from "@napier/contracts/browser-interaction-confirmation";

import { canonicalJson, sha256 } from "./ed25519.js";

export function browserInteractionConfirmationPreview(
  args: unknown,
): BrowserInteractionConfirmationPreview {
  const projection = browserToolCallArgumentsLedgerProjection(args);
  const value = record(projection) ? projection : {};
  const selectorSha256 = text(value["selectorSha256"]);
  const refSha256 = text(value["refSha256"]);
  const textSha256 = text(value["textSha256"]);
  const pathSha256 = text(value["pathSha256"]);
  const valueSetSha256 = text(value["valueSetSha256"]);
  const expectedLiveImageSha256 = text(value["expectedLiveImageSha256"]);
  return {
    ...(selectorSha256
      ? { targetKind: "selector", targetSha256: selectorSha256 }
      : refSha256
        ? { targetKind: "ref", targetSha256: refSha256 }
        : {}),
    ...(textSha256 ? { textSha256 } : {}),
    ...(typeof value["textBytes"] === "number"
      ? { textBytes: value["textBytes"] }
      : {}),
    ...(typeof value["valueCount"] === "number"
      ? { valueCount: value["valueCount"] }
      : {}),
    ...(valueSetSha256 ? { valueSetSha256 } : {}),
    ...(pathSha256 ? { pathSha256 } : {}),
    ...(expectedLiveImageSha256
      ? { sourceImageSha256: expectedLiveImageSha256 }
      : {}),
    crossOriginAuthorized: value["crossOriginAuthorized"] === true,
  };
}

export function browserToolCallArgumentsLedgerProjection(
  args: unknown,
): JsonValue {
  const value = record(args) ? args : {};
  const action =
    typeof value["action"] === "string" ? value["action"] : "unknown";
  const target = record(value["target"]) ? value["target"] : {};
  const url = text(value["url"]);
  const inputText = text(value["text"]);
  const query = text(value["query"]).replace(/\s+/gu, " ").trim();
  const filePath = text(value["path"]);
  const tabId = text(value["tabId"]);
  const expectedLiveImageSha256 = text(value["expectedLiveImageSha256"]);
  const selector = text(target["selector"]);
  const ref = text(target["ref"]);
  const values = Array.isArray(value["values"])
    ? value["values"].filter(
        (entry): entry is string => typeof entry === "string",
      )
    : [];
  return {
    kind: "napier.redacted-tool-arguments",
    schemaVersion: 1,
    redacted: true,
    action,
    ...(url ? { urlSha256: sha256(url), originSha256: hashOrigin(url) } : {}),
    ...(inputText
      ? {
          textSha256: sha256(inputText),
          textBytes: Buffer.byteLength(inputText, "utf8"),
        }
      : {}),
    ...(query ? { querySha256: sha256(query), queryChars: query.length } : {}),
    ...(value["direction"] === "up" || value["direction"] === "down"
      ? { direction: value["direction"] }
      : {}),
    ...(typeof value["pixels"] === "number" ? { pixels: value["pixels"] } : {}),
    ...(filePath ? { pathSha256: sha256(filePath) } : {}),
    ...(expectedLiveImageSha256 ? { expectedLiveImageSha256 } : {}),
    ...(tabId ? { tabIdSha256: sha256(tabId) } : {}),
    ...(selector ? { selectorSha256: sha256(selector) } : {}),
    ...(ref ? { refSha256: sha256(ref) } : {}),
    ...(values.length > 0
      ? {
          valueCount: values.length,
          valueSetSha256: sha256(canonicalJson(values)),
        }
      : {}),
    crossOriginAuthorized: value["allowCrossOrigin"] === true,
    inputSha256: browserToolCallSha256(args),
  };
}

export function browserToolInputLedgerProjection(
  args: unknown,
): Record<string, JsonValue> {
  const projection = browserToolCallArgumentsLedgerProjection(args);
  const action =
    record(projection) && typeof projection["action"] === "string"
      ? projection["action"]
      : "unknown";
  return {
    action,
    inputSha256: browserToolCallSha256(args),
    inputRedacted: true,
  };
}

export function browserToolOutputLedgerProjection(
  output: string,
  result: unknown,
): Record<string, JsonValue> {
  const details =
    record(result) && record(result["details"]) ? result["details"] : {};
  return {
    outputSha256: sha256(output),
    outputBytes: Buffer.byteLength(output, "utf8"),
    outputRedacted: true,
    resultSha256: sha256(canonicalJson(toJsonValue(details))),
  };
}

function browserToolCallSha256(args: unknown): string {
  return sha256(canonicalJson(toJsonValue(args)));
}

function hashOrigin(value: string): string {
  try {
    return sha256(new URL(value).origin);
  } catch {
    return sha256("");
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toJsonValue(value: unknown): JsonValue {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    return String(value);
  }
}
