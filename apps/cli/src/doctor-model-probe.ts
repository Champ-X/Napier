import { ModelRegistry } from "@napier/runtime/model";
import { sha256 } from "@napier/runtime/core";

import type { CliDoctorOptions } from "./cli-doctor-options.js";
import type {
  DoctorCheck,
  DoctorCredentialReferenceStatus,
} from "./doctor-check-model.js";

export async function defaultModelProbe(
  options: CliDoctorOptions,
  env: Readonly<Record<string, string | undefined>>,
  credentialReference?: DoctorCredentialReferenceStatus,
): Promise<DoctorCheck> {
  const startedAt = Date.now();
  if (!options.model) {
    return {
      id: "model",
      status: "warning",
      required: false,
      code: "model_not_selected",
      message: "No model was selected; rerun Doctor with --model",
      durationMs: Date.now() - startedAt,
    };
  }
  const registry = new ModelRegistry();
  if (options.model.provider !== "napier" && !registry.resolve(options.model)) {
    return {
      id: "model",
      status: "failed",
      required: true,
      code: "model_unknown",
      message: "The selected model is not present in the installed catalog",
      durationMs: Date.now() - startedAt,
      evidence: { model: `${options.model.provider}/${options.model.id}` },
    };
  }
  if (options.model.provider === "napier" && options.model.id === "demo") {
    return {
      id: "model",
      status: "passed",
      required: false,
      code: "demo_model_ready",
      message: "The deterministic demo model is available without credentials",
      durationMs: Date.now() - startedAt,
      evidence: { model: "napier/demo" },
    };
  }
  if (!options.credentialEnv && credentialReference === "available") {
    return {
      id: "model",
      status: "passed",
      required: true,
      code: "credential_reference_available",
      message:
        "The selected model uses an available active credential reference",
      durationMs: Date.now() - startedAt,
      evidence: {
        model: `${options.model.provider}/${options.model.id}`,
        credentialSource: "active_reference",
      },
    };
  }
  if (!options.credentialEnv) {
    return missingReferenceCheck(options.model, credentialReference, startedAt);
  }
  const available = Boolean(env[options.credentialEnv]?.trim());
  return {
    id: "model",
    status: available ? "passed" : "failed",
    required: true,
    code: available ? "credential_available" : "credential_missing",
    message: available
      ? "The selected model credential environment variable is available"
      : "The selected model credential environment variable is missing",
    durationMs: Date.now() - startedAt,
    evidence: {
      model: `${options.model.provider}/${options.model.id}`,
      credentialVariableSha256: sha256(options.credentialEnv),
    },
  };
}

function missingReferenceCheck(
  model: NonNullable<CliDoctorOptions["model"]>,
  credentialReference: DoctorCredentialReferenceStatus | undefined,
  startedAt: number,
): DoctorCheck {
  const unavailable = credentialReference === "error";
  return {
    id: "model",
    status: "failed",
    required: true,
    code: unavailable
      ? "credential_reference_unavailable"
      : "credential_reference_missing",
    message: unavailable
      ? "The selected model active credential reference could not be resolved"
      : "The selected model has no active credential reference",
    durationMs: Date.now() - startedAt,
    evidence: {
      model: `${model.provider}/${model.id}`,
      credentialSource: "active_reference",
    },
  };
}
