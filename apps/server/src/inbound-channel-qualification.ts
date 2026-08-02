import type {
  InboundDeadLetterExport,
  InboundDelivery,
  InboundDeliveryQualification,
} from "@napier/contracts";

import { sha256Json } from "./http-response-evidence.js";

export function createInboundDeliveryQualification(
  delivery: InboundDelivery,
  currentAdapterCatalogSha256: string,
): InboundDeliveryQualification {
  const diagnostics: string[] = [];
  if (!delivery.bodySha256) {
    diagnostics.push("Inbound body SHA-256 evidence is missing.");
  }
  if (!delivery.adapterCatalogSha256) {
    diagnostics.push("Inbound adapter catalog SHA-256 evidence is missing.");
  }
  const status: InboundDeliveryQualification["status"] =
    diagnostics.length > 0
      ? "evidence_missing"
      : delivery.adapterCatalogSha256 !== currentAdapterCatalogSha256
        ? "adapter_catalog_drift"
        : "qualified";
  if (status === "adapter_catalog_drift") {
    diagnostics.push(
      "Inbound adapter catalog SHA-256 differs from the current server catalog.",
    );
  }
  if (status === "qualified") {
    diagnostics.push(
      "Inbound delivery evidence is present and matches the current adapter catalog.",
    );
  }
  const content = {
    schemaVersion: 1 as const,
    channelId: delivery.channelId,
    deliveryId: delivery.id,
    status,
    ...(delivery.bodySha256 ? { bodySha256: delivery.bodySha256 } : {}),
    ...(delivery.adapterCatalogSha256
      ? { adapterCatalogSha256: delivery.adapterCatalogSha256 }
      : {}),
    currentAdapterCatalogSha256,
    diagnostics,
  };
  return {
    ...content,
    contentSha256: sha256Json(content),
  };
}

export function inboundDeadLetterQualificationSummary(
  artifact: InboundDeadLetterExport,
): Record<string, number> {
  if (
    artifact.qualifiedCount !== undefined &&
    artifact.evidenceMissingCount !== undefined &&
    artifact.adapterCatalogDriftCount !== undefined
  ) {
    return {
      qualifiedCount: artifact.qualifiedCount,
      evidenceMissingCount: artifact.evidenceMissingCount,
      adapterCatalogDriftCount: artifact.adapterCatalogDriftCount,
    };
  }
  return {
    qualifiedCount: artifact.deliveries.filter(
      (delivery) => delivery.qualificationStatus === "qualified",
    ).length,
    evidenceMissingCount: artifact.deliveries.filter(
      (delivery) => delivery.qualificationStatus === "evidence_missing",
    ).length,
    adapterCatalogDriftCount: artifact.deliveries.filter(
      (delivery) => delivery.qualificationStatus === "adapter_catalog_drift",
    ).length,
  };
}
