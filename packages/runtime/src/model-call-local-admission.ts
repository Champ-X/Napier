import type { ModelCallAdmission } from "./model-call-admission.js";
import type { ModelPhysicalObservationV1 } from "@napier/contracts/model-accounting";
import { normalizeModelPhysicalObservation } from "./model-usage-observation.js";
import type { ModelUsageSource } from "./model-usage-source.js";

/** Standalone runtime accounting has durability even without host capacity policy. */
export function createLocalModelCallAdmission(source: ModelUsageSource, capacity?: ModelCallAdmission): ModelCallAdmission {
  return { ...capacity, usageSource: source, reserve(input) {
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
  } };
}
