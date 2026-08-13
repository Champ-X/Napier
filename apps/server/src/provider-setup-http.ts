import type { ApplyProviderSetupRequest } from "@napier/contracts/provider-setup";
import type { ProviderSetupService } from "@napier/runtime/provider-setup";
import { Hono } from "hono";

import {
  errorMessage,
  jsonError,
  setStableContentSha256Header,
} from "./http-response-evidence.js";
import {
  readLimitedJson,
  RequestBodyTooLargeError,
} from "./http-request-body.js";
import { requestRecord } from "./http-request-validation.js";

const MAX_PROVIDER_SETUP_REQUEST_BYTES = 1_024;

export function registerProviderSetupHttp(
  app: Hono,
  setup: ProviderSetupService,
): void {
  app.get("/api/setup/providers", async (context) => {
    const preview = await setup.preview();
    context.header("Cache-Control", "no-store");
    setStableContentSha256Header(context, preview.contentSha256);
    return context.json(preview);
  });
  app.post("/api/setup/providers", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_PROVIDER_SETUP_REQUEST_BYTES,
        "Provider setup request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const request = parseApplyProviderSetupRequest(input);
    if (!request) {
      return jsonError(context, "Provider setup request is invalid", 400);
    }
    try {
      const result = await setup.apply(request);
      context.header("Cache-Control", "no-store");
      setStableContentSha256Header(context, result.contentSha256);
      return context.json(result);
    } catch (error) {
      return jsonError(context, errorMessage(error), 409);
    }
  });
}

function parseApplyProviderSetupRequest(
  input: unknown,
): ApplyProviderSetupRequest | undefined {
  const record = requestRecord(input, ["providerId", "expectedPreviewSha256"]);
  const providerId = record?.["providerId"];
  const expectedPreviewSha256 = record?.["expectedPreviewSha256"];
  return record &&
    typeof providerId === "string" &&
    /^[a-z][a-z0-9_-]{0,63}$/u.test(providerId) &&
    typeof expectedPreviewSha256 === "string" &&
    /^[a-f0-9]{64}$/u.test(expectedPreviewSha256)
    ? { providerId, expectedPreviewSha256 }
    : undefined;
}
