import type { BrowserOutputArtifactRegistrar } from "./browser-output-artifact.js";
import type {
  BrowserSessionOperationResult,
  BrowserSessionOwner,
  BrowserSessionRequest,
} from "./browser-session-model.js";

export async function settleBrowserToolOutput(input: {
  owner: BrowserSessionOwner;
  request: BrowserSessionRequest;
  result: BrowserSessionOperationResult;
  registrar?: Pick<BrowserOutputArtifactRegistrar, "register">;
}): Promise<string> {
  if (
    (input.request.action !== "save_screenshot" &&
      input.request.action !== "download") ||
    !input.result.details.file ||
    !input.registrar
  ) {
    return input.result.output;
  }
  const registration = await input.registrar
    .register(input.owner, {
      action: input.request.action,
      path: input.request.path,
      pathSha256: input.result.details.file.pathSha256,
      fileSha256: input.result.details.file.fileSha256,
      fileBytes: input.result.details.file.fileBytes,
    })
    .catch(() => ({
      status: "failed" as const,
      reason: "artifact_registration_failed" as const,
    }));
  return `${input.result.output}\nPlan Artifact: ${
    registration.status === "registered"
      ? "verified"
      : `not verified (${registration.reason})`
  }`;
}
