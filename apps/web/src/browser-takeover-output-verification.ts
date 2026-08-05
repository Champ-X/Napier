import type { ExecuteBrowserTakeoverActionRequest } from "@napier/contracts/browser-takeover";

import { sha256Text } from "./stable-digest";

const HASH = /^[a-f0-9]{64}$/u;

export async function verifyBrowserTakeoverOutputEvidence(
  input: Record<string, unknown>,
  request: ExecuteBrowserTakeoverActionRequest,
): Promise<boolean | undefined> {
  if (request.action === "download") {
    return (
      input["targetRefSha256"] === (await sha256Text(request.ref)) &&
      input["outputPathSha256"] === (await sha256Text(request.path)) &&
      hash(input["outputFileSha256"]) &&
      boundedCount(input["outputFileBytes"], 1, 32 * 1024 * 1024) &&
      hash(input["suggestedFilenameSha256"]) &&
      input["sourceLiveImageSha256"] === undefined &&
      input["viewportWidth"] === undefined &&
      input["viewportHeight"] === undefined
    );
  }
  if (request.action === "save_screenshot") {
    return (
      input["outputPathSha256"] === (await sha256Text(request.path)) &&
      input["outputFileSha256"] === request.expectedLiveImageSha256 &&
      boundedCount(input["outputFileBytes"], 1, 8 * 1024 * 1024) &&
      input["suggestedFilenameSha256"] === undefined &&
      input["sourceLiveImageSha256"] === request.expectedLiveImageSha256 &&
      input["viewportWidth"] === request.expectedViewportWidth &&
      input["viewportHeight"] === request.expectedViewportHeight
    );
  }
  return undefined;
}

function hash(value: unknown): value is string {
  return typeof value === "string" && HASH.test(value);
}

function boundedCount(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    Number.isSafeInteger(value) &&
    Number(value) >= minimum &&
    Number(value) <= maximum
  );
}
