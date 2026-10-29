import type {
  ModelCallAttributionV1,
  ModelPhysicalObservationV1,
} from "@napier/contracts/model-accounting";
import { canonicalJson } from "./ed25519.js";

declare const deliveryBrand: unique symbol;
export interface VerifiedModelUsageDelivery {
  readonly [deliveryBrand]: true;
}
export interface ModelUsageDeliveryRecord {
  sourceId: string;
  attribution: ModelCallAttributionV1;
  observation: ModelPhysicalObservationV1;
}
const deliveries = new WeakMap<
  object,
  { record: ModelUsageDeliveryRecord; reread(): ModelUsageDeliveryRecord }
>();

/** Only durable native source readers call this issuer. JSON/import cannot register a delivery. */
export function modelUsageDeliveryIssuer(
  sourceId: string,
  reread: (physicalId: string) => ModelUsageDeliveryRecord,
) {
  return (
    attribution: ModelCallAttributionV1,
    observation: ModelPhysicalObservationV1,
  ): VerifiedModelUsageDelivery => {
    if (
      attribution.receiptSourceId !== sourceId ||
      observation.physicalId !== attribution.physicalId ||
      observation.attributionSha256 !== attribution.contentSha256
    )
      throw new Error("Model usage delivery binding differs");
    const capability = Object.freeze({}) as VerifiedModelUsageDelivery;
    deliveries.set(capability, {
      record: structuredClone({ sourceId, attribution, observation }),
      reread: () => reread(attribution.physicalId),
    });
    return capability;
  };
}

export function readVerifiedModelUsageDelivery(
  delivery: VerifiedModelUsageDelivery,
): ModelUsageDeliveryRecord {
  const binding =
    delivery && typeof delivery === "object"
      ? deliveries.get(delivery)
      : undefined;
  if (!binding)
    throw new Error("Native model usage delivery authority is required");
  const current = binding.reread();
  if (canonicalJson(current) !== canonicalJson(binding.record))
    throw new Error("Native model usage source binding changed");
  return structuredClone(current);
}
