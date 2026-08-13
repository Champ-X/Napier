import type {
  BrowserConfirmedActionManager,
  BrowserConfirmationPageState,
} from "./browser-confirmed-action.js";
import type { BrowserOutputArtifactRegistrar } from "./browser-output-artifact.js";
import { settleBrowserToolOutput } from "./browser-tool-output.js";
import type { RunBrowserSessionManager } from "./browser-session.js";
import type {
  BrowserSessionOwner,
  BrowserSessionRequest,
} from "./browser-session-model.js";
import type { BrowserUploadAuthorizationManager } from "./browser-upload-authorization.js";

type ConfirmedBrowserRequest = Extract<
  BrowserSessionRequest,
  { action: "click" | "type" | "select" | "upload" | "download" }
>;

export async function executeBrowserTool(input: {
  manager: RunBrowserSessionManager;
  owner: BrowserSessionOwner;
  callId: string;
  request: BrowserSessionRequest;
  signal?: AbortSignal;
  actionConfirmations?: Pick<BrowserConfirmedActionManager, "consume">;
  uploadAuthorizations?: Pick<BrowserUploadAuthorizationManager, "consume">;
  outputArtifacts?: Pick<BrowserOutputArtifactRegistrar, "register">;
}) {
  const confirmed = confirmedRequest(input.request);
  const pageState =
    confirmed && input.actionConfirmations
      ? input.actionConfirmations.consume({
          owner: input.owner,
          callId: input.callId,
          request: confirmed,
        })
      : undefined;
  const result = await executeRequest(input, confirmed, pageState);
  const settledOutput = await settleBrowserToolOutput({
    owner: input.owner,
    request: input.request,
    result,
    ...(input.outputArtifacts ? { registrar: input.outputArtifacts } : {}),
  });
  const output = pageState
    ? confirmedBrowserActionOutput(settledOutput, pageState)
    : settledOutput;
  return { result, output };
}

function confirmedBrowserActionOutput(
  output: string,
  pageState: BrowserConfirmationPageState,
): string {
  return [
    "Confirmation consumed: Napier received and consumed the exact one-use user approval for this Browser action before execution.",
    `Approved effect: ${pageState.targetEffect}.`,
    `Confirmed page state SHA-256: ${pageState.contentSha256}.`,
    output,
  ].join("\n");
}

async function executeRequest(
  input: Parameters<typeof executeBrowserTool>[0],
  confirmed: ConfirmedBrowserRequest | undefined,
  pageState: BrowserConfirmationPageState | undefined,
) {
  if (
    input.request.action === "upload" &&
    input.uploadAuthorizations &&
    pageState
  ) {
    const upload = input.uploadAuthorizations.consume({
      owner: input.owner,
      callId: input.callId,
      request: input.request,
    });
    try {
      return await input.manager.executeConfirmedUpload(
        input.owner,
        input.request,
        upload,
        pageState,
        input.signal,
      );
    } finally {
      upload.buffer.fill(0);
    }
  }
  if (confirmed && confirmed.action !== "upload" && pageState) {
    return await input.manager.executeConfirmedAction(
      input.owner,
      confirmed,
      pageState,
      input.signal,
    );
  }
  return await input.manager.execute(input.owner, input.request, input.signal);
}

function confirmedRequest(
  request: BrowserSessionRequest,
): ConfirmedBrowserRequest | undefined {
  return request.action === "click" ||
    request.action === "type" ||
    request.action === "select" ||
    request.action === "upload" ||
    request.action === "download"
    ? request
    : undefined;
}
