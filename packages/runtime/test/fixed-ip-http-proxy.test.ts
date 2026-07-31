import { createServer as createHttpServer, request } from "node:http";
import {
  connect,
  createServer as createTcpServer,
  type Server as TcpServer,
  type Socket,
} from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type FixedIpProxyBinding,
  type FixedIpProxyDial,
  FixedIpHttpProxy,
} from "../src/fixed-ip-http-proxy.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.allSettled(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe("FixedIpHttpProxy", () => {
  it("forwards HTTP through the validated address instead of resolving again", async () => {
    const origin = createHttpServer((incoming, response) => {
      expect(incoming.url).toBe("/resource?view=full");
      expect(incoming.headers.host).toBe("example.com");
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("proxied response");
    });
    const originPort = await listen(origin);
    cleanups.push(() => closeServer(origin));
    const dial = redirectDial(originPort);
    const proxy = new FixedIpHttpProxy({
      lookup: async () => [{ address: "1.1.1.1", family: 4 }],
      dial,
    });
    const binding = await proxy.start();
    proxy.setOutboundEnabled(true);
    cleanups.push(() => proxy.close());

    await expect(
      proxyRequest(binding, "http://example.com/resource?view=full"),
    ).resolves.toEqual({
      status: 200,
      body: "proxied response",
    });
    expect(dial).toHaveBeenCalledWith(
      expect.objectContaining({
        address: "1.1.1.1",
        family: 4,
        port: 80,
      }),
    );
    expect(proxy.snapshot()).toEqual(
      expect.objectContaining({
        requestCount: 1,
        rejectedCount: 0,
        destinationCount: 1,
      }),
    );
  });

  it("keeps outbound traffic disabled outside an explicit browser action", async () => {
    const dial = vi.fn<FixedIpProxyDial>();
    const proxy = new FixedIpHttpProxy({
      lookup: async () => [{ address: "1.1.1.1", family: 4 }],
      dial,
    });
    const binding = await proxy.start();
    cleanups.push(() => proxy.close());

    await expect(
      proxyRequest(binding, "http://example.com/background"),
    ).resolves.toEqual({
      status: 403,
      body: "Proxy Outbound Disabled",
    });
    expect(dial).not.toHaveBeenCalled();
  });

  it("requires proxy authentication and rejects private or mixed DNS answers", async () => {
    const dial = vi.fn<FixedIpProxyDial>();
    const proxy = new FixedIpHttpProxy({
      lookup: async (hostname) =>
        hostname === "mixed.example"
          ? [
              { address: "1.1.1.1", family: 4 },
              { address: "127.0.0.1", family: 4 },
            ]
          : [{ address: "1.1.1.1", family: 4 }],
      dial,
    });
    const binding = await proxy.start();
    proxy.setOutboundEnabled(true);
    cleanups.push(() => proxy.close());

    await expect(
      proxyRequest(binding, "http://example.com/", false),
    ).resolves.toEqual({
      status: 407,
      body: "Proxy Authentication Required",
    });
    await expect(
      proxyRequest(binding, "http://127.0.0.1/private"),
    ).resolves.toEqual({
      status: 502,
      body: "Bad Gateway",
    });
    await expect(
      proxyRequest(binding, "http://mixed.example/private"),
    ).resolves.toEqual({
      status: 502,
      body: "Bad Gateway",
    });
    expect(dial).not.toHaveBeenCalled();
    expect(proxy.snapshot()).toEqual(
      expect.objectContaining({
        requestCount: 3,
        rejectedCount: 3,
        destinationCount: 0,
      }),
    );
  });

  it("creates an authenticated CONNECT tunnel to the pinned public address", async () => {
    const echo = createTcpServer((socket) => socket.pipe(socket));
    const echoPort = await listen(echo);
    cleanups.push(() => closeTcpServer(echo));
    const dial = redirectDial(echoPort);
    const proxy = new FixedIpHttpProxy({
      lookup: async () => [{ address: "2606:4700:4700::1111", family: 6 }],
      dial,
    });
    const binding = await proxy.start();
    proxy.setOutboundEnabled(true);
    cleanups.push(() => proxy.close());

    await expect(connectThroughProxy(binding, "secure.example")).resolves.toBe(
      "tunnel payload",
    );
    expect(dial).toHaveBeenCalledWith(
      expect.objectContaining({
        address: "2606:4700:4700::1111",
        family: 6,
        port: 443,
      }),
    );
    expect(proxy.snapshot()).toEqual(
      expect.objectContaining({
        requestCount: 1,
        connectCount: 1,
        rejectedCount: 0,
        destinationCount: 1,
      }),
    );
  });

  it("rejects malformed, non-HTTPS-port, and private CONNECT authorities", async () => {
    const dial = vi.fn<FixedIpProxyDial>();
    const proxy = new FixedIpHttpProxy({
      lookup: async () => [{ address: "1.1.1.1", family: 4 }],
      dial,
    });
    const binding = await proxy.start();
    proxy.setOutboundEnabled(true);
    cleanups.push(() => proxy.close());

    await expect(
      openTunnelTarget(binding, "secure.example:80"),
    ).rejects.toThrow("502");
    await expect(
      openTunnelTarget(binding, "secure.example:443?smuggled=true"),
    ).rejects.toThrow("502");
    await expect(openTunnelTarget(binding, "127.0.0.1:443")).rejects.toThrow(
      "502",
    );
    expect(dial).not.toHaveBeenCalled();
  });

  it("destroys active CONNECT tunnels when the proxy closes", async () => {
    const echo = createTcpServer((socket) => socket.pipe(socket));
    const echoPort = await listen(echo);
    cleanups.push(() => closeTcpServer(echo));
    const proxy = new FixedIpHttpProxy({
      lookup: async () => [{ address: "1.1.1.1", family: 4 }],
      dial: redirectDial(echoPort),
    });
    const binding = await proxy.start();
    proxy.setOutboundEnabled(true);
    const socket = await openTunnel(binding, "secure.example");

    const closed = new Promise<void>((resolve) =>
      socket.once("close", () => resolve()),
    );
    await proxy.close();
    await expect(closed).resolves.toBeUndefined();
  });
});

function redirectDial(port: number) {
  return vi.fn<FixedIpProxyDial>(
    async () =>
      new Promise<Socket>((resolve, reject) => {
        const socket = connect({ host: "127.0.0.1", port });
        socket.once("error", reject);
        socket.once("connect", () => {
          socket.removeListener("error", reject);
          resolve(socket);
        });
      }),
  );
}

async function proxyRequest(
  binding: FixedIpProxyBinding,
  target: string,
  authenticated = true,
): Promise<{ status: number; body: string }> {
  const proxy = new URL(binding.server);
  return new Promise((resolve, reject) => {
    const outgoing = request({
      host: proxy.hostname,
      port: Number(proxy.port),
      path: target,
      headers: authenticated
        ? { "proxy-authorization": authorization(binding) }
        : {},
    });
    outgoing.once("error", reject);
    outgoing.once("response", (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.once("end", () =>
        resolve({
          status: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf8"),
        }),
      );
      response.once("error", reject);
    });
    outgoing.end();
  });
}

async function connectThroughProxy(
  binding: FixedIpProxyBinding,
  hostname: string,
): Promise<string> {
  const socket = await openTunnel(binding, hostname);
  return new Promise<string>((resolve, reject) => {
    socket.once("error", reject);
    socket.once("data", (chunk) => {
      socket.destroy();
      resolve(chunk.toString("utf8"));
    });
    socket.write("tunnel payload");
  });
}

async function openTunnel(
  binding: FixedIpProxyBinding,
  hostname: string,
): Promise<Socket> {
  return openTunnelTarget(binding, `${hostname}:443`);
}

async function openTunnelTarget(
  binding: FixedIpProxyBinding,
  target: string,
): Promise<Socket> {
  const proxy = new URL(binding.server);
  return new Promise<Socket>((resolve, reject) => {
    const socket = connect({
      host: proxy.hostname,
      port: Number(proxy.port),
    });
    let response = "";
    const onData = (chunk: Buffer) => {
      response += chunk.toString("utf8");
      if (!response.includes("\r\n\r\n")) return;
      socket.off("data", onData);
      if (!response.startsWith("HTTP/1.1 200")) {
        socket.destroy();
        reject(new Error(response));
        return;
      }
      resolve(socket);
    };
    socket.once("error", reject);
    socket.on("data", onData);
    socket.once("connect", () => {
      socket.write(
        [
          `CONNECT ${target} HTTP/1.1`,
          `Host: ${target}`,
          `Proxy-Authorization: ${authorization(binding)}`,
          "",
          "",
        ].join("\r\n"),
      );
    });
  });
}

function authorization(binding: FixedIpProxyBinding): string {
  return `Basic ${Buffer.from(
    `${binding.username}:${binding.password}`,
  ).toString("base64")}`;
}

async function listen(
  server: ReturnType<typeof createHttpServer> | TcpServer,
): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind");
  }
  return address.port;
}

async function closeServer(
  server: ReturnType<typeof createHttpServer>,
): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function closeTcpServer(server: TcpServer): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
