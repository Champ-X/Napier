import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";

import { FixedIpHttpProxy } from "../packages/runtime/dist/index.js";

const MAX_FRONT_CONNECTIONS = 64;

export async function startOpenWebComparisonPublicProxy(options = {}) {
  const requireAuthentication = options.requireAuthentication !== false;
  const frontToken = randomBytes(32).toString("base64url");
  const frontAuthorization = `Basic ${Buffer.from(
    `comparison:${frontToken}`,
  ).toString("base64")}`;
  const backend = new FixedIpHttpProxy({
    maxOutboundConnections: 16,
    maxRequests: 256,
    maxTransferBytes: 64 * 1024 * 1024,
    connectTimeoutMs: 10_000,
    idleTimeoutMs: 30_000,
  });
  const binding = await backend.start();
  backend.setOutboundEnabled(true);
  const target = new URL(binding.server);
  const authorization = `Basic ${Buffer.from(
    `${binding.username}:${binding.password}`,
  ).toString("base64")}`;
  const sockets = new Set();
  const server = createServer((incoming, response) => {
    if (
      requireAuthentication &&
      !authorized(incoming.headers["proxy-authorization"], frontAuthorization)
    ) {
      response.writeHead(407, {
        "proxy-authenticate": 'Basic realm="comparison"',
      });
      response.end();
      return;
    }
    const upstream = httpRequest({
      hostname: target.hostname,
      port: target.port,
      method: incoming.method,
      path: incoming.url,
      headers: {
        ...incoming.headers,
        "proxy-authorization": authorization,
      },
    });
    upstream.on("response", (upstreamResponse) => {
      response.writeHead(
        upstreamResponse.statusCode ?? 502,
        upstreamResponse.headers,
      );
      upstreamResponse.pipe(response);
    });
    upstream.on("error", () => {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    });
    incoming.pipe(upstream);
  });
  server.on("connect", (incoming, clientSocket, head) => {
    clientSocket.on("error", () => clientSocket.destroy());
    if (
      requireAuthentication &&
      !authorized(incoming.headers["proxy-authorization"], frontAuthorization)
    ) {
      clientSocket.end(
        'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="comparison"\r\nConnection: close\r\n\r\n',
      );
      return;
    }
    const upstream = httpRequest({
      hostname: target.hostname,
      port: target.port,
      method: "CONNECT",
      path: incoming.url,
      headers: { "proxy-authorization": authorization },
    });
    upstream.on("connect", (upstreamResponse, upstreamSocket, upstreamHead) => {
      if (upstreamResponse.statusCode !== 200) {
        clientSocket.end(
          `HTTP/1.1 ${String(upstreamResponse.statusCode ?? 502)} Bad Gateway\r\nConnection: close\r\n\r\n`,
        );
        upstreamSocket.destroy();
        return;
      }
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.byteLength > 0) upstreamSocket.write(head);
      if (upstreamHead.byteLength > 0) clientSocket.write(upstreamHead);
      clientSocket.pipe(upstreamSocket);
      upstreamSocket.pipe(clientSocket);
      const close = () => {
        clientSocket.destroy();
        upstreamSocket.destroy();
      };
      clientSocket.once("error", close);
      upstreamSocket.once("error", close);
    });
    upstream.on("error", () => {
      clientSocket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
    });
    upstream.end();
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("error", () => socket.destroy());
    socket.once("close", () => sockets.delete(socket));
  });
  server.maxConnections = MAX_FRONT_CONNECTIONS;
  let closed = false;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await backend.close();
    throw new Error("Comparison public proxy address is invalid");
  }
  return {
    server: `http://127.0.0.1:${String(address.port)}`,
    proxyUrl: requireAuthentication
      ? `http://comparison:${encodeURIComponent(frontToken)}@127.0.0.1:${String(address.port)}`
      : `http://127.0.0.1:${String(address.port)}`,
    ...(requireAuthentication
      ? {
          credential: frontToken,
          proxyAuthorization: frontAuthorization,
        }
      : {}),
    port: address.port,
    snapshot: () => backend.snapshot(),
    async close() {
      if (closed) return;
      closed = true;
      backend.setOutboundEnabled(false);
      for (const socket of sockets) socket.destroy();
      server.closeAllConnections();
      await Promise.all([
        server.listening
          ? new Promise((resolve) => server.close(resolve))
          : Promise.resolve(),
        backend.close(),
      ]);
    },
  };
}

function authorized(value, expected) {
  if (typeof value !== "string") return false;
  const actualBytes = Buffer.from(value);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}
