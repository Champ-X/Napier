import { createServer } from "node:http";

export async function startOpenWebComparisonBrowserBlocker() {
  let requestCount = 0;
  const server = createServer();
  server.on("request", (_request, response) => {
    requestCount += 1;
    response.writeHead(503, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    response.end('{"error":"isolated browser unavailable"}');
  });
  server.on("upgrade", (_request, socket) => {
    requestCount += 1;
    socket.destroy();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Comparison Browser blocker address is invalid");
  }
  let closed = false;
  return {
    cdpUrl: `http://127.0.0.1:${String(address.port)}`,
    port: address.port,
    receipt: {
      status: "blocked",
      diagnostic: "nested_chromium_sandbox_unavailable",
      get requestCount() {
        return requestCount;
      },
    },
    async close() {
      if (closed) return;
      closed = true;
      server.closeAllConnections();
      if (server.listening) {
        await new Promise((resolve) => server.close(resolve));
      }
    },
  };
}
