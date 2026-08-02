import { type ChannelService, type LocalStore } from "@napier/runtime";
import { Hono } from "hono";

import { jsonError } from "./http-response-evidence.js";
import { inboundChannelAdapterCatalogSha256 } from "./inbound-channel-adapter-catalog.js";
import {
  setInboundDeliveryListHeaders,
  setInboundDeliveryProjectionHeaders,
  setInboundDeliveryQualificationHeaders,
} from "./inbound-channel-delivery-http-response.js";
import { createInboundDeliveryQualification } from "./inbound-channel-qualification.js";

type InboundChannelDeliveryHttpStore = Pick<
  LocalStore,
  "getInboundChannel" | "listInboundDeliveries"
>;

export interface InboundChannelDeliveryHttpServices {
  store: InboundChannelDeliveryHttpStore;
  channels: Pick<ChannelService, "retry">;
}

export function registerInboundChannelDeliveryHttp(
  app: Hono,
  services: InboundChannelDeliveryHttpServices,
): void {
  app.get("/api/channels/:channelId/deliveries", (context) => {
    const channelId = context.req.param("channelId");
    services.store.getInboundChannel(channelId);
    const deliveries = services.store.listInboundDeliveries(channelId);
    setInboundDeliveryListHeaders(context, channelId, deliveries);
    return context.json(deliveries);
  });

  app.get(
    "/api/channels/:channelId/deliveries/:deliveryId/qualification",
    (context) => {
      const channelId = context.req.param("channelId");
      services.store.getInboundChannel(channelId);
      const delivery = services.store
        .listInboundDeliveries(channelId)
        .find((candidate) => candidate.id === context.req.param("deliveryId"));
      if (!delivery) {
        return jsonError(context, "Inbound delivery not found", 404);
      }
      const qualification = createInboundDeliveryQualification(
        delivery,
        inboundChannelAdapterCatalogSha256(),
      );
      setInboundDeliveryQualificationHeaders(context, qualification);
      return context.json(qualification);
    },
  );

  app.post(
    "/api/channels/:channelId/deliveries/:deliveryId/retry",
    async (context) => {
      try {
        const delivery = await services.channels.retry(
          context.req.param("channelId"),
          context.req.param("deliveryId"),
        );
        setInboundDeliveryProjectionHeaders(context, delivery);
        return context.json(delivery, 202);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          message.includes("can be retried") ||
          message.includes("retry limit") ||
          message.includes("still active")
        ) {
          return jsonError(context, message, 409);
        }
        throw error;
      }
    },
  );
}
