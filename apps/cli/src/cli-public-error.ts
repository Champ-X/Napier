import type { StreamFrame } from "@napier/contracts";
import { streamRunErrorFrame } from "@napier/runtime";

const PUBLIC_MESSAGES = {
  credential_env_unavailable:
    "Credential environment variable is unavailable. Set the selected --credential-env variable and retry.",
  credential_reference_conflict:
    "This provider already uses a different active credential reference. Use that locator or update it through setup, then retry.",
  credential_reference_unavailable:
    "The selected credential reference is unavailable. Restore its environment credential and retry.",
  model_unavailable:
    "The selected model is unavailable after credential bootstrap. Verify the provider/model, then run napier doctor with the same --model and --credential-env.",
  sandbox_unavailable:
    "This task mode requires a supported process Sandbox. Run `napier setup --workspace 'WORKSPACE_PATH' --component sandbox`, apply its exact preview, then verify with `napier doctor --workspace 'WORKSPACE_PATH' --offline`.",
} as const;

export type CliPublicErrorCode = keyof typeof PUBLIC_MESSAGES;

export class CliPublicError extends Error {
  readonly publicMessage: string;

  constructor(
    readonly publicCode: CliPublicErrorCode,
    diagnosticMessage: string,
  ) {
    super(diagnosticMessage);
    this.name = "CliPublicError";
    this.publicMessage = PUBLIC_MESSAGES[publicCode];
  }
}

function cliPublicErrorMessage(error: unknown): string | undefined {
  return error instanceof CliPublicError ? error.publicMessage : undefined;
}

export function cliErrorFrame(
  threadId: string,
  error: unknown,
): Extract<StreamFrame, { type: "error" }> {
  const frame = streamRunErrorFrame(threadId, error);
  const message = cliPublicErrorMessage(error);
  return message ? { ...frame, message } : frame;
}
