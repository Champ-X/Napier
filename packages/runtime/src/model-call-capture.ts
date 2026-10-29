import type { Api, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { ModelCallCaptureBinding } from "@napier/contracts/model-accounting";
import type { ModelContextEnvelopeReceipt } from "@napier/contracts";
import { canonicalJson, sha256 } from "./ed25519.js";
import { applyModelAdapterOptions, modelAdapterReceipt } from "./model-adapter-receipt.js";
import { applyProviderWireCompatibility } from "./model-provider-wire-compatibility.js";
import { modelInputAllowance } from "./model-call-budget-allowance.js";

/** Credential values and callback objects never enter the persisted request binding. */
export function modelGenerationOptionsProjection(options?: SimpleStreamOptions) {
  if (!options) return {};
  const value: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(options)) {
    if (key === "signal") continue;
    if (key === "apiKey" || key === "headers" || key === "env") {
      value[`${key}Present`] = field !== undefined;
      continue;
    }
    if (typeof field === "function") {
      value[`${key}CallbackPresent`] = true;
      continue;
    }
    if (field !== undefined) value[key] = structuredClone(field);
  }
  return value;
}

export function modelAdmittedRequestDigests(input: {
  model: Model<Api>;
  context: Context;
  options?: SimpleStreamOptions | undefined;
}) {
  const model = applyProviderWireCompatibility(input.model);
  const options = applyModelAdapterOptions(input.model, input.options);
  const contextSha256 = sha256(canonicalJson(input.context));
  const generationOptionsSha256 = sha256(canonicalJson(modelGenerationOptionsProjection(options)));
  const admittedModelSha256 = sha256(canonicalJson(model));
  return { contextSha256, generationOptionsSha256, admittedModelSha256,
    requestSha256: sha256(canonicalJson({ contextSha256, generationOptionsSha256, admittedModelSha256 })) };
}

export function createModelCallCaptureBinding(input: {
  model: Model<Api>;
  context: Context;
  options?: SimpleStreamOptions | undefined;
  envelope: ModelContextEnvelopeReceipt;
  privateCapsule?: ModelCallCaptureBinding["privateCapsule"];
}): ModelCallCaptureBinding {
  return { envelope: structuredClone(input.envelope), adapter: modelAdapterReceipt(input.model, input.options),
    inputAllowance: modelInputAllowance(input.model, input.context),
    ...modelAdmittedRequestDigests(input), requestScope: "admitted_input_v1",
    privateCapsule: input.privateCapsule ?? { status: "not_requested" } };
}
