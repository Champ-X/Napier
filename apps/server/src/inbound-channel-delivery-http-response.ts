import type {
  InboundDelivery,
  InboundDeliveryQualification,
  InboundReceipt,
} from "@napier/contracts";
import type { Context } from "hono";

import {
  setBodyContentSha256Header,
  setContentSha256Header,
  setStableContentSha256Header,
  sha256Json,
  sha256Text,
} from "./http-response-evidence.js";

export function setInboundDeliveryListHeaders(
  context: Context,
  channelId: string,
  deliveries: readonly InboundDelivery[],
): void {
  const deliveryListSha256 = sha256Text(JSON.stringify(deliveries));
  context.header("Cache-Control", "no-store");
  setContentSha256Header(context, deliveryListSha256, "body");
  context.header("X-Napier-Delivery-List-SHA256", deliveryListSha256);
  context.header("X-Napier-Channel-Id", channelId);
  context.header("X-Napier-Delivery-Count", String(deliveries.length));
  context.header(
    "X-Napier-Delivery-Ids-SHA256",
    sha256Json(deliveries.map((delivery) => delivery.id).sort()),
  );
  for (const status of [
    "accepted",
    "running",
    "retrying",
    "completed",
    "failed",
  ] satisfies InboundDelivery["status"][]) {
    context.header(
      `X-Napier-${status[0]!.toUpperCase()}${status.slice(1)}-Delivery-Count`,
      String(
        deliveries.filter((delivery) => delivery.status === status).length,
      ),
    );
  }
}

export function setInboundDeliveryProjectionHeaders(
  context: Context,
  delivery: InboundDelivery,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, delivery);
  context.header("X-Napier-Channel-Id", delivery.channelId);
  context.header("X-Napier-Thread-Id", delivery.threadId);
  context.header("X-Napier-Delivery-Id", delivery.id);
  context.header("X-Napier-Trigger-Id", delivery.triggerId);
  context.header("X-Napier-Delivery-Status", delivery.status);
  context.header("X-Napier-Attempt-Count", String(delivery.attemptCount));
  context.header("X-Napier-Max-Attempts", String(delivery.maxAttempts));
  context.header("X-Napier-Delivery-Revision", String(delivery.revision));
  context.header(
    "X-Napier-Idempotency-Fingerprint",
    delivery.idempotencyFingerprint,
  );
  if (delivery.runId) {
    context.header("X-Napier-Run-Id", delivery.runId);
  }
  if (delivery.nextAttemptAt) {
    context.header("X-Napier-Next-Attempt-At", delivery.nextAttemptAt);
  }
  if (delivery.bodySha256) {
    context.header("X-Napier-Body-SHA256", delivery.bodySha256);
  }
  if (delivery.adapterCatalogSha256) {
    context.header(
      "X-Napier-Adapter-Catalog-SHA256",
      delivery.adapterCatalogSha256,
    );
  }
}

export function setInboundReceiptHeaders(
  context: Context,
  receipt: InboundReceipt,
): void {
  setInboundDeliveryProjectionHeaders(context, receipt.delivery);
  setBodyContentSha256Header(context, receipt);
  context.header("X-Napier-Duplicate", String(receipt.duplicate));
}

export function setInboundDeliveryQualificationHeaders(
  context: Context,
  qualification: InboundDeliveryQualification,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, qualification.contentSha256);
  context.header("X-Napier-Channel-Id", qualification.channelId);
  context.header("X-Napier-Delivery-Id", qualification.deliveryId);
  context.header("X-Napier-Qualification-Status", qualification.status);
  context.header(
    "X-Napier-Diagnostic-Count",
    String(qualification.diagnostics.length),
  );
  context.header(
    "X-Napier-Current-Adapter-Catalog-SHA256",
    qualification.currentAdapterCatalogSha256,
  );
  if (qualification.bodySha256) {
    context.header("X-Napier-Body-SHA256", qualification.bodySha256);
  }
  if (qualification.adapterCatalogSha256) {
    context.header(
      "X-Napier-Adapter-Catalog-SHA256",
      qualification.adapterCatalogSha256,
    );
  }
}
