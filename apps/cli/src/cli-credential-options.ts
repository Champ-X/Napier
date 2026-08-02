import type { ModelRef } from "@napier/contracts";

const CREDENTIAL_ENVIRONMENT = /^[A-Z_][A-Z0-9_]{1,127}$/u;

export interface CliCredentialBootstrapOptions {
  model?: ModelRef;
  credentialEnv?: string;
}

export function parseCredentialEnvironment(
  values: ReadonlyMap<string, string>,
  model: ModelRef | undefined,
): string | undefined {
  const credentialEnv = values.get("--credential-env")?.trim();
  if (credentialEnv === undefined) return undefined;
  if (!CREDENTIAL_ENVIRONMENT.test(credentialEnv)) {
    throw new Error("--credential-env is invalid");
  }
  if (!model || model.provider === "napier") {
    throw new Error("--credential-env requires a live --model");
  }
  return credentialEnv;
}
