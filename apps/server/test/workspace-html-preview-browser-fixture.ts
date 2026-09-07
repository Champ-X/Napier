import { serve } from "@hono/node-server";
import { Hono } from "hono";

import { registerWorkspaceDirectoriesHttp } from "../src/workspace-directories-http.js";

export async function startWorkspaceHtmlPreviewFixture(root: string) {
  const app = new Hono();
  let forbiddenRequests = 0;
  registerWorkspaceDirectoriesHttp(app, undefined, () => root);
  app.get("/api/private", (context) => {
    forbiddenRequests++;
    return context.text("private");
  });
  app.get("/", (context) =>
    context.html(
      '<!doctype html><html><body><iframe title="preview" sandbox="allow-scripts" style="width:760px;height:500px"></iframe></body></html>',
    ),
  );
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
  if (!server.listening)
    await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing fixture server address");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    forbiddenRequests: () => forbiddenRequests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
