import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  Agent,
  createServer,
  request as createHttpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import {
  connect as connectTcp,
  type Socket,
  type TcpNetConnectOpts,
} from "node:net";
import type { Duplex } from "node:stream";

import {
  effectivePort,
  type PublicHostLookup,
  resolvePublicHost,
  validatePublicHttpUrl,
} from "./public-network.js";

export const MAX_PROXY_OUTBOUND_CONNECTIONS = 32;
export const MAX_PROXY_REQUESTS = 512;
export const MAX_PROXY_TRANSFER_BYTES = 128 * 1024 * 1024;
export const PROXY_CONNECT_TIMEOUT_MS = 10_000;
export const PROXY_IDLE_TIMEOUT_MS = 60_000;

export interface FixedIpProxyBinding {
  server: string;
  username: string;
  password: string;
}

export interface FixedIpProxySnapshot {
  requestCount: number;
  connectCount: number;
  rejectedCount: number;
  transferredBytes: number;
  destinationCount: number;
  destinationsSha256: string;
}

export interface FixedIpProxyDialRequest {
  address: string;
  family: 4 | 6;
  port: number;
  connectTimeoutMs: number;
  idleTimeoutMs: number;
}

export type FixedIpProxyDial = (
  request: FixedIpProxyDialRequest,
) => Promise<Socket>;

export interface FixedIpHttpProxyOptions {
  lookup?: PublicHostLookup;
  dial?: FixedIpProxyDial;
  maxOutboundConnections?: number;
  maxRequests?: number;
  maxTransferBytes?: number;
  connectTimeoutMs?: number;
  idleTimeoutMs?: number;
}

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export class FixedIpHttpProxy {
  private readonly username = "napier";
  private readonly password = randomBytes(24).toString("base64url");
  private readonly expectedAuthorization = `Basic ${Buffer.from(
    `${this.username}:${this.password}`,
  ).toString("base64")}`;
  private readonly clientSockets = new Set<Duplex>();
  private readonly outboundSockets = new Set<Socket>();
  private readonly destinations = new Set<string>();
  private server: Server | undefined;
  private binding: FixedIpProxyBinding | undefined;
  private requestCount = 0;
  private connectCount = 0;
  private rejectedCount = 0;
  private transferredBytes = 0;
  private outboundEnabled = false;
  private closing = false;

  constructor(private readonly options: FixedIpHttpProxyOptions = {}) {}

  async start(): Promise<FixedIpProxyBinding> {
    if (this.binding) return this.binding;
    if (this.closing) throw new Error("Proxy is closing");
    const server = createServer((request, response) => {
      void this.handleHttp(request, response);
    });
    server.on("connect", (request, socket, head) => {
      void this.handleConnect(request, socket, head);
    });
    server.on("connection", (socket) => {
      this.trackSocket(this.clientSockets, socket);
    });
    server.on("clientError", (_error, socket) => {
      this.rejectSocket(socket, 400, "Bad Request");
    });
    server.maxConnections = this.maxOutboundConnections * 2;
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(0, "127.0.0.1");
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      await this.close();
      throw new Error("Proxy did not bind a TCP address");
    }
    this.binding = {
      server: `http://127.0.0.1:${address.port}`,
      username: this.username,
      password: this.password,
    };
    return this.binding;
  }

  snapshot(): FixedIpProxySnapshot {
    const destinations = [...this.destinations].sort();
    return {
      requestCount: this.requestCount,
      connectCount: this.connectCount,
      rejectedCount: this.rejectedCount,
      transferredBytes: this.transferredBytes,
      destinationCount: destinations.length,
      destinationsSha256: createHash("sha256")
        .update(JSON.stringify(destinations))
        .digest("hex"),
    };
  }

  setOutboundEnabled(enabled: boolean): void {
    if (this.closing && enabled) {
      throw new Error("Proxy is closing");
    }
    this.outboundEnabled = enabled;
    if (!enabled) {
      for (const socket of this.outboundSockets) socket.destroy();
    }
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    this.binding = undefined;
    for (const socket of [...this.clientSockets, ...this.outboundSockets]) {
      socket.destroy();
    }
    const server = this.server;
    this.server = undefined;
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  }

  private async handleHttp(
    incoming: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      if (!this.admit(incoming.headers["proxy-authorization"])) {
        this.rejectHttp(response, 407, "Proxy Authentication Required", {
          "proxy-authenticate": 'Basic realm="Napier Browser Session"',
        });
        return;
      }
      if (!this.outboundEnabled) {
        this.rejectHttp(response, 403, "Proxy Outbound Disabled");
        return;
      }
      const url = validatePublicHttpUrl(incoming.url ?? "");
      if (url.protocol !== "http:") {
        throw new Error("HTTPS requests must use CONNECT");
      }
      const resolution = await resolvePublicHost(url.hostname, {
        ...(this.options.lookup ? { lookup: this.options.lookup } : {}),
      });
      this.destinations.add(url.origin);
      const socket = await this.dial(
        resolution.addresses[0]!,
        effectivePort(url),
      );
      if (incoming.destroyed || response.destroyed || this.closing) {
        socket.destroy();
        return;
      }
      const headers = forwardHeaders(incoming.headers);
      headers.host = url.host;
      const agent = new Agent({ keepAlive: false });
      agent.createConnection = () => socket;
      const upstream = createHttpRequest({
        method: incoming.method,
        path: `${url.pathname}${url.search}`,
        headers,
        agent,
      });
      upstream.once("close", () => agent.destroy());
      upstream.once("response", (upstreamResponse) => {
        response.writeHead(
          upstreamResponse.statusCode ?? 502,
          forwardHeaders(upstreamResponse.headers),
        );
        upstreamResponse.on("data", (chunk: Buffer) => {
          this.accountTransfer(chunk.byteLength, socket, response);
        });
        upstreamResponse.pipe(response);
      });
      upstream.once("error", () => {
        if (!response.headersSent) {
          this.rejectHttp(response, 502, "Bad Gateway");
        } else {
          response.destroy();
        }
      });
      incoming.on("data", (chunk: Buffer) => {
        this.accountTransfer(chunk.byteLength, socket, response);
      });
      incoming.pipe(upstream);
    } catch {
      if (!response.headersSent) {
        this.rejectHttp(response, 502, "Bad Gateway");
      } else {
        response.destroy();
      }
    }
  }

  private async handleConnect(
    incoming: IncomingMessage,
    clientSocket: Duplex,
    head: Buffer,
  ): Promise<void> {
    try {
      if (!this.admit(incoming.headers["proxy-authorization"])) {
        this.rejectSocket(
          clientSocket,
          407,
          "Proxy Authentication Required",
          'Proxy-Authenticate: Basic realm="Napier Browser Session"\r\n',
        );
        return;
      }
      if (!this.outboundEnabled) {
        this.rejectSocket(clientSocket, 403, "Proxy Outbound Disabled");
        return;
      }
      const target = incoming.url ?? "";
      if (!target || /[/@\\?#]/u.test(target)) {
        throw new Error("CONNECT target is invalid");
      }
      const url = validatePublicHttpUrl(`https://${target}`);
      if (effectivePort(url) !== 443) {
        throw new Error("CONNECT port is not allowed");
      }
      const resolution = await resolvePublicHost(url.hostname, {
        ...(this.options.lookup ? { lookup: this.options.lookup } : {}),
      });
      this.destinations.add(url.origin);
      const upstream = await this.dial(resolution.addresses[0]!, 443);
      if (clientSocket.destroyed || this.closing) {
        upstream.destroy();
        return;
      }
      this.connectCount += 1;
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.byteLength > 0) {
        this.accountTransfer(head.byteLength, upstream, clientSocket);
        upstream.write(head);
      }
      clientSocket.on("data", (chunk: Buffer) => {
        this.accountTransfer(chunk.byteLength, upstream, clientSocket);
      });
      upstream.on("data", (chunk: Buffer) => {
        this.accountTransfer(chunk.byteLength, upstream, clientSocket);
      });
      clientSocket.pipe(upstream);
      upstream.pipe(clientSocket);
      const closePeer = () => {
        clientSocket.destroy();
        upstream.destroy();
      };
      clientSocket.once("error", closePeer);
      upstream.once("error", closePeer);
      clientSocket.once("close", () => upstream.destroy());
      upstream.once("close", () => clientSocket.destroy());
    } catch {
      this.rejectSocket(clientSocket, 502, "Bad Gateway");
    }
  }

  private admit(authorization: string | undefined): boolean {
    this.requestCount += 1;
    if (
      this.closing ||
      this.requestCount > this.maxRequests ||
      !secureEqual(authorization, this.expectedAuthorization)
    ) {
      return false;
    }
    return true;
  }

  private async dial(
    address: { address: string; family: number },
    port: number,
  ): Promise<Socket> {
    if (
      !this.outboundEnabled ||
      this.outboundSockets.size >= this.maxOutboundConnections
    ) {
      throw new Error("Proxy outbound connection limit reached");
    }
    const family = address.family === 6 ? 6 : 4;
    const socket = await (this.options.dial ?? defaultDial)({
      address: address.address,
      family,
      port,
      connectTimeoutMs:
        this.options.connectTimeoutMs ?? PROXY_CONNECT_TIMEOUT_MS,
      idleTimeoutMs: this.options.idleTimeoutMs ?? PROXY_IDLE_TIMEOUT_MS,
    });
    this.trackSocket(this.outboundSockets, socket);
    return socket;
  }

  private accountTransfer(
    bytes: number,
    upstream: Socket,
    downstream: { destroy(): void },
  ): void {
    this.transferredBytes += bytes;
    if (this.transferredBytes <= this.maxTransferBytes) return;
    upstream.destroy();
    downstream.destroy();
  }

  private rejectHttp(
    response: ServerResponse,
    status: number,
    message: string,
    headers: Record<string, string> = {},
  ): void {
    this.rejectedCount += 1;
    response.writeHead(status, {
      connection: "close",
      "content-type": "text/plain; charset=utf-8",
      ...headers,
    });
    response.end(message);
  }

  private rejectSocket(
    socket: Duplex,
    status: number,
    message: string,
    extraHeaders = "",
  ): void {
    this.rejectedCount += 1;
    if (!socket.destroyed) {
      socket.end(
        `HTTP/1.1 ${status} ${message}\r\n${extraHeaders}Connection: close\r\n\r\n`,
      );
    }
  }

  private trackSocket<T extends Duplex>(collection: Set<T>, socket: T): void {
    collection.add(socket);
    socket.once("close", () => collection.delete(socket));
  }

  private get maxOutboundConnections(): number {
    return (
      this.options.maxOutboundConnections ?? MAX_PROXY_OUTBOUND_CONNECTIONS
    );
  }

  private get maxRequests(): number {
    return this.options.maxRequests ?? MAX_PROXY_REQUESTS;
  }

  private get maxTransferBytes(): number {
    return this.options.maxTransferBytes ?? MAX_PROXY_TRANSFER_BYTES;
  }
}

async function defaultDial(request: FixedIpProxyDialRequest): Promise<Socket> {
  return new Promise<Socket>((resolve, reject) => {
    const options: TcpNetConnectOpts = {
      host: request.address,
      family: request.family,
      port: request.port,
    };
    const socket = connectTcp(options);
    const timeout = setTimeout(() => {
      socket.destroy(new Error("Proxy connection timed out"));
    }, request.connectTimeoutMs);
    timeout.unref();
    const onError = (error: Error) => {
      clearTimeout(timeout);
      reject(error);
    };
    socket.once("error", onError);
    socket.once("connect", () => {
      clearTimeout(timeout);
      socket.off("error", onError);
      socket.setNoDelay(true);
      socket.setTimeout(request.idleTimeoutMs, () => socket.destroy());
      resolve(socket);
    });
  });
}

function forwardHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([name]) => !HOP_BY_HOP_HEADERS.has(name.toLowerCase()),
    ),
  );
}

function secureEqual(actual: string | undefined, expected: string): boolean {
  if (actual === undefined) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.byteLength === expectedBytes.byteLength &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}
