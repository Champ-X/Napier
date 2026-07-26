import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { StreamableHttpMcpClient } from "../src/mcp.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  );
});

describe("StreamableHttpMcpClient", () => {
  it("negotiates a session, lists tools, calls one, and closes cleanly", async () => {
    const methods: string[] = [];
    const sessionHeaders: Array<string | undefined> = [];
    const server = createServer(async (request, response) => {
      if (request.method === "DELETE") {
        methods.push("DELETE");
        sessionHeaders.push(
          typeof request.headers["mcp-session-id"] === "string"
            ? request.headers["mcp-session-id"]
            : undefined,
        );
        response.writeHead(204).end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        id?: number;
        method: string;
        params?: Record<string, unknown>;
      };
      methods.push(payload.method);
      sessionHeaders.push(
        typeof request.headers["mcp-session-id"] === "string"
          ? request.headers["mcp-session-id"]
          : undefined,
      );
      if (payload.method === "notifications/initialized") {
        response.writeHead(202).end();
        return;
      }

      let result: Record<string, unknown>;
      if (payload.method === "initialize") {
        result = {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "fixture", version: "1.0.0" },
        };
        response.setHeader("mcp-session-id", "session-fixture");
      } else if (payload.method === "tools/list") {
        result = {
          tools: [
            {
              name: "search",
              description: "Search fixture records",
              inputSchema: {
                type: "object",
                properties: { query: { type: "string" } },
                required: ["query"],
              },
            },
          ],
        };
      } else if (payload.method === "tools/call") {
        expect(payload.params).toEqual({
          name: "search",
          arguments: { query: "ledger" },
        });
        result = {
          content: [{ type: "text", text: "Fixture result" }],
          structuredContent: { count: 1 },
          isError: false,
        };
      } else {
        response.writeHead(400).end();
        return;
      }
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: payload.id,
          result,
        }),
      );
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Fixture server did not expose a TCP address");
    }
    const client = new StreamableHttpMcpClient({
      type: "streamable_http",
      url: `http://127.0.0.1:${address.port}/mcp`,
    });

    await client.initialize();
    const catalog = await client.listTools();
    const result = await client.callTool("search", { query: "ledger" });
    await client.close();

    expect(catalog.tools).toEqual([
      expect.objectContaining({
        name: "search",
        description: "Search fixture records",
      }),
    ]);
    expect(result).toEqual({
      contentText: 'Fixture result\n{"count":1}',
      isError: false,
    });
    expect(methods).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list",
      "tools/call",
      "DELETE",
    ]);
    expect(sessionHeaders).toEqual([
      undefined,
      "session-fixture",
      "session-fixture",
      "session-fixture",
      "session-fixture",
    ]);
  });
});
