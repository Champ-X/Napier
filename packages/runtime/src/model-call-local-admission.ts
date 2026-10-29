import type { ModelCallAdmission } from "./model-call-admission.js";
import type { ModelPhysicalObservationV1 } from "@napier/contracts/model-accounting";
import { normalizeModelPhysicalObservation } from "./model-usage-observation.js";
import type { ModelUsageSource } from "./model-usage-source.js";
import { bindModelAccountingSource } from "./model-accounting-binding.js";
import { readEnteredModelCall } from "./model-call-attribution.js";

/** Standalone runtime accounting has durability even without host capacity policy. */
export function createLocalModelCallAdmission(source: ModelUsageSource, capacity?: ModelCallAdmission): ModelCallAdmission {
  const reserve: ModelCallAdmission["reserve"] = (input) => {
    const attribution = input.attribution;
    if (!attribution) throw new Error("Native model call requires an explicit accounting owner");
    source.reserve(attribution);
    const capacityLease = capacity?.reserve(input);
    let observation: ModelPhysicalObservationV1 | undefined;
    return { settle(message) {
      observation ??= normalizeModelPhysicalObservation({ attribution, ...(message ? { message } : {}),
        terminal: message ? "response" : "rejected" });
      capacityLease?.settle(message);
      source.record(observation);
    } };
  };
  const admission: ModelCallAdmission = Object.freeze({ ...capacity, reserve(input: Parameters<ModelCallAdmission["reserve"]>[0]) {
    if (input.attribution) throw new Error("Native dispatch authority is required");
    return capacity?.reserve(input) ?? { settle() {} };
  } });
  bindModelAccountingSource(admission, { source, reserve(input, call) {
    if (readEnteredModelCall(call).attribution !== input.attribution)
      throw new Error("Native dispatch authority differs from attribution");
    return reserve(input);
  } });
  return admission;
}
