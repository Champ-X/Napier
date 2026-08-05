import { createServer } from "node:http";
import { Readable } from "node:stream";

import { sha256 } from "../packages/runtime/dist/index.js";

const UPSTREAM_URL = "https://api.deepseek.com/v1/chat/completions";
const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const MAX_REQUEST_COUNT = 64;

export async function startOpenWebComparisonModelProxy(input) {
  if (!input.upstreamApiKey || !input.childApiKey) {
    throw new Error("Comparison model proxy credentials are unavailable");
  }
  const receipt = {
    requestCount: 0,
    requestBytes: 0,
    responseBytes: 0,
    rejectedCount: 0,
    modelMatch: true,
    upstreamOriginSha256: sha256(new URL(UPSTREAM_URL).origin),
  };
  const activeControllers = new Set();
  let closed = false;
  const server = createServer(async (request, response) => {
    try {
      await handleRequest(request, response, input, receipt, activeControllers);
    } catch {
      receipt.rejectedCount += 1;
      if (!response.headersSent) {
        response.writeHead(502, { "content-type": "application/json" });
      }
      response.end('{"error":{"message":"comparison proxy rejected request"}}');
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Comparison model proxy address is invalid");
  }
  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}/v1`,
    receipt,
    async close() {
      if (closed) return;
      closed = true;
      for (const controller of activeControllers) controller.abort();
      server.closeAllConnections();
      if (server.listening) {
        await new Promise((resolve) => server.close(resolve));
      }
    },
  };
}

async function handleRequest(
  request,
  response,
  input,
  receipt,
  activeControllers,
) {
  const upstreamUrl = input.upstreamUrl ?? UPSTREAM_URL;
  const fetchImpl = input.fetchImpl ?? fetch;
  if (
    request.method !== "POST" ||
    request.url !== "/v1/chat/completions" ||
    bearerToken(request.headers.authorization) !== input.childApiKey ||
    receipt.requestCount >= MAX_REQUEST_COUNT
  ) {
    receipt.rejectedCount += 1;
    response.writeHead(403, { "content-type": "application/json" });
    response.end('{"error":{"message":"comparison proxy request denied"}}');
    return;
  }
  const body = await readBoundedRequest(request);
  receipt.requestCount += 1;
  receipt.requestBytes += body.byteLength;
  const parsed = JSON.parse(body.toString("utf8"));
  if (!record(parsed) || parsed.model !== "deepseek-v4-flash") {
    receipt.modelMatch = false;
    receipt.rejectedCount += 1;
    response.writeHead(400, { "content-type": "application/json" });
    response.end('{"error":{"message":"comparison model mismatch"}}');
    return;
  }
  const controller = new AbortController();
  activeControllers.add(controller);
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const upstream = await fetchImpl(upstreamUrl, {
      method: "POST",
      redirect: "error",
      headers: {
        accept: "text/event-stream, application/json",
        authorization: `Bearer ${input.upstreamApiKey}`,
        "content-type": "application/json",
      },
      body,
      signal: controller.signal,
    });
    response.writeHead(upstream.status, {
      "content-type":
        upstream.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    if (!upstream.body) {
      response.end();
      return;
    }
    const stream = Readable.fromWeb(upstream.body);
    stream.on("data", (chunk) => {
      receipt.responseBytes += chunk.byteLength;
      if (receipt.responseBytes > MAX_RESPONSE_BYTES) {
        stream.destroy(new Error("Comparison proxy response limit exceeded"));
      }
    });
    await new Promise((resolve, reject) => {
      stream.once("error", reject);
      response.once("error", reject);
      response.once("finish", resolve);
      response.once("close", resolve);
      stream.pipe(response);
    });
  } finally {
    clearTimeout(timer);
    activeControllers.delete(controller);
  }
}

async function readBoundedRequest(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.byteLength;
    if (bytes > MAX_REQUEST_BYTES) {
      throw new Error("Comparison proxy request limit exceeded");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, bytes);
}

function bearerToken(value) {
  const match =
    typeof value === "string" ? /^Bearer ([^\s]{1,512})$/u.exec(value) : null;
  return match?.[1];
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
