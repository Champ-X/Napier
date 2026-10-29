import type { Api, Model, MutableModels, StreamOptions } from "@earendil-works/pi-ai";
import { applyProviderWireCompatibility } from "./model-provider-wire-compatibility.js";
import { createAdmittedModels, type ModelCallAdmission } from "./model-call-admission.js";
import { bindModelCallRegistry } from "./model-call-attribution.js";
import { applyModelAdapterOptions } from "./model-adapter-receipt.js";
export { applyModelAdapterOptions, modelAdapterReceipt, validateModelAdapterReceipt,
  MODEL_ADAPTER_DEFAULT_STREAM_OPTION_MAX_TOKENS } from "./model-adapter-receipt.js";
export type { ModelAdapterId, LegacyModelAdapterReceipt, ModelAdapterReceipt, ModelAdapterReceiptV2 } from "./model-adapter-receipt.js";

export function createModelAdapterModels(models: MutableModels, admission?: ModelCallAdmission): MutableModels {
  const admitted = createAdmittedModels(models, admission);
  const adapted = new Proxy(admitted, {
    get(target, property) {
      if (
        property === "stream" ||
        property === "complete" ||
        property === "streamSimple" ||
        property === "completeSimple"
      ) {
        return (model: Model<Api>, context: unknown, options?: StreamOptions) =>
          Reflect.apply(target[property], target, [
            applyProviderWireCompatibility(model),
            context,
            applyModelAdapterOptions(model, options),
          ]);
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  bindModelCallRegistry(adapted, admitted);
  return adapted;
}
