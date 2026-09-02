import type { LocalStore } from "@napier/runtime/store";
import { Hono } from "hono";

import {
  errorMessage,
  jsonError,
  setBodyContentSha256Header,
} from "./http-response-evidence.js";

interface LocalModelDisplayRecord {
  kind: "napier.local-model-display";
  schemaVersion: 1;
  sourceThreadId: string;
  sourceRunId: string;
  responseEventId: string;
  modelContextEnvelopeTurnIndex?: number;
  text?: string;
  thinking?: string;
  origin: "captured_response" | "conversation_surface";
  contentSha256: string;
}

type ModelDisplayHttpServices = {
  store: Pick<LocalStore, "getThread">;
  modelDisplays: {
    listThread(threadId: string): Promise<LocalModelDisplayRecord[]>;
  };
};

export interface LocalModelDisplayResponse {
  kind: "napier.local-model-display-list";
  schemaVersion: 1;
  threadId: string;
  records: LocalModelDisplayRecord[];
}

export function registerModelDisplayHttp(
  app: Hono,
  services: ModelDisplayHttpServices,
): void {
  app.get("/api/threads/:threadId/local-model-displays", async (context) => {
    const threadId = context.req.param("threadId");
    try {
      services.store.getThread(threadId);
      const response: LocalModelDisplayResponse = {
        kind: "napier.local-model-display-list",
        schemaVersion: 1,
        threadId,
        records: await services.modelDisplays.listThread(threadId),
      };
      context.header("Cache-Control", "no-store");
      context.header("X-Content-Type-Options", "nosniff");
      context.header("X-Napier-Local-Only", "model-display");
      context.header("X-Napier-Thread-Id", threadId);
      setBodyContentSha256Header(context, response);
      return context.json(response);
    } catch (error) {
      const message = errorMessage(error);
      return jsonError(
        context,
        message,
        message.includes("not found") ? 404 : 500,
      );
    }
  });
}
