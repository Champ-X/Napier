import type { LocalStore } from "@napier/runtime/store";
import { Hono } from "hono";

import {
  errorMessage,
  jsonError,
  setBodyContentSha256Header,
} from "./http-response-evidence.js";

type ToolDisplayHttpServices = {
  store: Pick<LocalStore, "getThread">;
  toolDisplays: {
    listThread(threadId: string): Promise<LocalToolDisplayRecord[]>;
  };
};

interface LocalToolDisplayRecord {
  kind: "napier.local-tool-display";
  schemaVersion: 1;
  sourceThreadId: string;
  sourceRunId: string;
  callId: string;
  toolName: string;
  input?: string;
  output?: string;
  error?: string;
  contentSha256: string;
}

export interface LocalToolDisplayResponse {
  kind: "napier.local-tool-display-list";
  schemaVersion: 1;
  threadId: string;
  records: LocalToolDisplayRecord[];
}

export function registerToolDisplayHttp(
  app: Hono,
  services: ToolDisplayHttpServices,
): void {
  app.get("/api/threads/:threadId/local-tool-displays", async (context) => {
    const threadId = context.req.param("threadId");
    try {
      services.store.getThread(threadId);
      const response: LocalToolDisplayResponse = {
        kind: "napier.local-tool-display-list",
        schemaVersion: 1,
        threadId,
        records: await services.toolDisplays.listThread(threadId),
      };
      context.header("Cache-Control", "no-store");
      context.header("X-Content-Type-Options", "nosniff");
      context.header("X-Napier-Local-Only", "tool-display");
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
