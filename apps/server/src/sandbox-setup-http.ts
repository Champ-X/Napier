import type {
  ApplySandboxSetupRequest,
  ApplySandboxUninstallRequest,
} from "@napier/contracts/sandbox-setup";
import type { SandboxSetupService } from "@napier/runtime/sandbox-setup-service";
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

const MAX_SANDBOX_SETUP_REQUEST_BYTES = 1_024;
const SANDBOX_SETUP_TIMEOUT_MS = 15 * 60 * 1_000;

export function registerSandboxSetupHttp(
  app: Hono,
  setup: SandboxSetupService,
): void {
  app.get("/api/setup/sandbox", async (context) => {
    try {
      const preview = await setup.preview();
      context.header("Cache-Control", "no-store");
      setStableContentSha256Header(context, preview.contentSha256);
      return context.json(preview);
    } catch (error) {
      return jsonError(context, errorMessage(error), 503);
    }
  });
  app.post("/api/setup/sandbox", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_SANDBOX_SETUP_REQUEST_BYTES,
        "Sandbox setup request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const request = parseApplySandboxSetupRequest(input);
    if (!request) {
      return jsonError(context, "Sandbox setup request is invalid", 400);
    }
    const timeout = AbortSignal.timeout(SANDBOX_SETUP_TIMEOUT_MS);
    const signal = AbortSignal.any([context.req.raw.signal, timeout]);
    try {
      const result = await setup.apply(request, signal);
      context.header("Cache-Control", "no-store");
      setStableContentSha256Header(context, result.contentSha256);
      return context.json(result);
    } catch (error) {
      const status = signal.aborted ? 503 : 409;
      return jsonError(context, errorMessage(error), status);
    }
  });
  app.get("/api/setup/sandbox/uninstall", async (context) => {
    try {
      const preview = await setup.uninstallPreview();
      context.header("Cache-Control", "no-store");
      setStableContentSha256Header(context, preview.contentSha256);
      return context.json(preview);
    } catch (error) {
      return jsonError(context, errorMessage(error), 503);
    }
  });
  app.post("/api/setup/sandbox/uninstall", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_SANDBOX_SETUP_REQUEST_BYTES,
        "Sandbox uninstall request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const request = parseApplySandboxUninstallRequest(input);
    if (!request) {
      return jsonError(context, "Sandbox uninstall request is invalid", 400);
    }
    try {
      const result = await setup.uninstall(request);
      context.header("Cache-Control", "no-store");
      setStableContentSha256Header(context, result.contentSha256);
      return context.json(result);
    } catch (error) {
      return jsonError(context, errorMessage(error), 409);
    }
  });
}

function parseApplySandboxSetupRequest(
  input: unknown,
): ApplySandboxSetupRequest | undefined {
  const record = requestRecord(input, ["expectedPreviewSha256"]);
  const expectedPreviewSha256 = record?.["expectedPreviewSha256"];
  return record &&
    typeof expectedPreviewSha256 === "string" &&
    /^[a-f0-9]{64}$/u.test(expectedPreviewSha256)
    ? { expectedPreviewSha256 }
    : undefined;
}

function parseApplySandboxUninstallRequest(
  input: unknown,
): ApplySandboxUninstallRequest | undefined {
  return parseApplySandboxSetupRequest(input) as
    | ApplySandboxUninstallRequest
    | undefined;
}
