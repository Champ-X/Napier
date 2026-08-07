import { createHash } from "node:crypto";

import type { EffectiveAgentCapabilityProjectionV1 } from "@napier/contracts/agent-capability-contract";
import { managementHttpErrorCodeForStatus } from "@napier/contracts/management-http";
import { describe, expect, it, vi } from "vitest";

import {
  createNapierManagementClient,
  NapierManagementClientError,
} from "../src/management.js";

const digest = "a".repeat(64);
const projection: EffectiveAgentCapabilityProjectionV1 = {
  kind: "napier.effective-agent-capabilities",
  schemaVersion: 1,
  agentId: "agent_napier",
  agentRevision: 1,
  contractId: "napier.default-agent.capabilities",
  contractVersion: 1,
  recommendationSha256: digest,
  driftState: "current",
  ownership: "recommended",
  explicitOverrideFields: [],
  toolPolicy: "observe",
  configuredTools: ["read_file"],
  runtimeExposedTools: ["read_file"],
  configuredSkills: [],
  configuredSubagents: [],
  readiness: [
    {
      id: "tool:read_file",
      status: "ready",
      configured: true,
      allowedByPolicy: true,
      exposed: true,
      detail: "Tool is available",
    },
  ],
  restorePreview: {
    schemaVersion: 1,
    contractId: "napier.default-agent.capabilities",
    contractVersion: 1,
    recommendationSha256: digest,
    agentId: "agent_napier",
    agentRevision: 1,
    currentManagedStateSha256: digest,
    targetManagedStateSha256: digest,
    operations: [],
    diffSha256: digest,
  },
  projectionSha256: digest,
};

describe("Napier management client", () => {
  it("returns a fully verified unchanged projection through GET", async () => {
    let request: { url: string; init?: RequestInit } | undefined;
    const baseUrl = new URL("https://napier.example/");
    const client = createNapierManagementClient({
      baseUrl,
      fetch: async (url, init) => {
        request = { url: String(url), ...(init ? { init } : {}) };
        return successResponse(projection, {
          "content-type": "application/json; charset=UTF-8",
        });
      },
    });
    baseUrl.hostname = "mutated.example";
    await expect(
      client.getEffectiveAgentCapabilities({ agentId: "agent_napier" }),
    ).resolves.toEqual(projection);
    expect(request).toMatchObject({
      url: "https://napier.example/api/agents/agent_napier/capabilities",
      init: { method: "GET", redirect: "error" },
    });
    expect(Object.keys(client)).toEqual(["getEffectiveAgentCapabilities"]);
    expect(client).not.toHaveProperty("close");
    expect(client).not.toHaveProperty("restore");
  });

  it("encodes the Agent identity as one path segment", async () => {
    let requested = "";
    const encodedProjection = { ...projection, agentId: "agent/a" };
    const client = createNapierManagementClient({
      baseUrl: "https://napier.example",
      fetch: async (url) => {
        requested = String(url);
        return successResponse(encodedProjection);
      },
    });
    await client.getEffectiveAgentCapabilities({ agentId: "agent/a" });
    expect(requested).toContain("/agent%2Fa/capabilities");
  });

  it.each([
    ["invalid scheme", { baseUrl: "file:///tmp/napier" }],
    ["credentials", { baseUrl: "https://user:pass@napier.example" }],
    ["query", { baseUrl: "https://napier.example?private=true" }],
    ["fragment", { baseUrl: "https://napier.example#private" }],
    ["non-root path", { baseUrl: "https://napier.example/api" }],
    [
      "zero timeout",
      { baseUrl: "https://napier.example", requestTimeoutMs: 0 },
    ],
    [
      "excessive timeout",
      { baseUrl: "https://napier.example", requestTimeoutMs: 30_001 },
    ],
    [
      "fractional timeout",
      { baseUrl: "https://napier.example", requestTimeoutMs: 1.5 },
    ],
  ])("rejects %s construction", (_name, options) => {
    expect(() => createNapierManagementClient(options)).toThrow(TypeError);
  });

  it.each([
    ["empty", ""],
    ["leading whitespace", " agent_napier"],
    ["trailing whitespace", "agent_napier "],
    ["control", "agent\u0000napier"],
    ["too many UTF-8 bytes", "界".repeat(86)],
  ])("rejects %s Agent identity", async (_name, agentId) => {
    const client = createNapierManagementClient({
      baseUrl: "https://napier.example",
      fetch: async () => successResponse(projection),
    });
    await expect(
      client.getEffectiveAgentCapabilities({ agentId }),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it("classifies caller pre-abort before fetch", async () => {
    const controller = new AbortController();
    controller.abort();
    let called = false;
    const client = createNapierManagementClient({
      baseUrl: "https://napier.example",
      fetch: async () => {
        called = true;
        return successResponse(projection);
      },
    });
    await expectErrorData(
      client.getEffectiveAgentCapabilities({
        agentId: "agent_napier",
        signal: controller.signal,
      }),
      { kind: "transport", reason: "aborted" },
    );
    expect(called).toBe(false);
  });

  it("classifies caller abort before simultaneous timeout", async () => {
    const controller = new AbortController();
    const client = createNapierManagementClient({
      baseUrl: "https://napier.example",
      requestTimeoutMs: 1,
      fetch: async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("raw")),
          );
          controller.abort();
        }),
    });
    await expectErrorData(
      client.getEffectiveAgentCapabilities({
        agentId: "agent_napier",
        signal: controller.signal,
      }),
      { kind: "transport", reason: "aborted" },
    );
  });

  it("classifies caller abort during a streamed response", async () => {
    const caller = new AbortController();
    let pullCount = 0;
    const client = createNapierManagementClient({
      baseUrl: "https://napier.example",
      fetch: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              if (pullCount === 0) {
                pullCount += 1;
                controller.enqueue(new Uint8Array([123]));
                return;
              }
              caller.abort();
              controller.error(new Error("private stream abort detail"));
            },
          }),
          { status: 200, headers: successHeaders(projection) },
        ),
    });
    await expectErrorData(
      client.getEffectiveAgentCapabilities({
        agentId: "agent_napier",
        signal: caller.signal,
      }),
      { kind: "transport", reason: "aborted" },
    );
  });

  it("rechecks caller abort after asynchronous digest work", async () => {
    const caller = new AbortController();
    const digest = globalThis.crypto.subtle.digest.bind(
      globalThis.crypto.subtle,
    );
    const digestSpy = vi
      .spyOn(globalThis.crypto.subtle, "digest")
      .mockImplementation(async (algorithm, data) => {
        caller.abort();
        return digest(algorithm, data);
      });
    try {
      const client = createNapierManagementClient({
        baseUrl: "https://napier.example",
        fetch: async () => successResponse(projection),
      });
      await expectErrorData(
        client.getEffectiveAgentCapabilities({
          agentId: "agent_napier",
          signal: caller.signal,
        }),
        { kind: "transport", reason: "aborted" },
      );
    } finally {
      digestSpy.mockRestore();
    }
  });

  it("classifies timeout without exposing the raw fetch failure", async () => {
    const client = createNapierManagementClient({
      baseUrl: "https://napier.example",
      requestTimeoutMs: 1,
      fetch: async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("private timeout detail")),
          );
        }),
    });
    const error = await capturedError(
      client.getEffectiveAgentCapabilities({ agentId: "agent_napier" }),
    );
    expect(error.data).toMatchObject({ kind: "transport", reason: "timeout" });
    expect(error.message).not.toContain("private timeout detail");
    expect(error).not.toHaveProperty("cause");
  });

  it.each(["synchronous", "asynchronous"])(
    "classifies %s fetch failure as network_failure",
    async (kind) => {
      const failingFetch =
        kind === "synchronous"
          ? () => {
              throw new Error("private fetch detail");
            }
          : async () => {
              throw new Error("private fetch detail");
            };
      const client = createNapierManagementClient({
        baseUrl: "https://napier.example",
        fetch: failingFetch,
      });
      await expectErrorData(
        client.getEffectiveAgentCapabilities({ agentId: "agent_napier" }),
        { kind: "transport", reason: "network_failure" },
      );
    },
  );

  it("classifies a stream reader failure as network_failure", async () => {
    const client = createNapierManagementClient({
      baseUrl: "https://napier.example",
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error("private stream detail"));
            },
          }),
          { status: 200, headers: successHeaders(projection) },
        ),
    });
    await expectErrorData(
      client.getEffectiveAgentCapabilities({ agentId: "agent_napier" }),
      { kind: "transport", reason: "network_failure" },
    );
  });

  it("rejects redirected, unexpected success and oversized responses", async () => {
    const redirected = successResponse(projection);
    Object.defineProperty(redirected, "redirected", { value: true });
    await expectResponseError(redirected, { reason: "redirected" });
    await expectResponseError(new Response(null, { status: 204 }), {
      reason: "unexpected_status",
    });
    await expectResponseError(
      successResponse(projection, { "content-length": String(2 ** 21 + 1) }),
      { reason: "response_too_large" },
    );
    const bytes = new Uint8Array(2 ** 21 + 1);
    await expectResponseError(
      new Response(bytes, {
        status: 200,
        headers: successHeaders(projection, bytes),
      }),
      { reason: "response_too_large" },
    );
  });

  it.each([
    [
      "content type",
      (response: Response) =>
        response.headers.set("content-type", "text/plain"),
      "protocol",
      "content_type_invalid",
    ],
    [
      "body mode",
      (response: Response) =>
        response.headers.delete("x-napier-content-sha256-mode"),
      "integrity",
      "content_hash_mode_invalid",
    ],
    [
      "missing content hash",
      (response: Response) =>
        response.headers.delete("x-napier-content-sha256"),
      "integrity",
      "content_hash_missing",
    ],
    [
      "invalid content hash",
      (response: Response) =>
        response.headers.set("x-napier-content-sha256", "ABC"),
      "integrity",
      "content_hash_invalid",
    ],
    [
      "mismatched content hash",
      (response: Response) =>
        response.headers.set("x-napier-content-sha256", "b".repeat(64)),
      "integrity",
      "content_hash_mismatch",
    ],
    [
      "missing projection hash",
      (response: Response) =>
        response.headers.delete("x-napier-agent-capability-projection-sha256"),
      "integrity",
      "projection_hash_missing",
    ],
    [
      "invalid projection hash",
      (response: Response) =>
        response.headers.set(
          "x-napier-agent-capability-projection-sha256",
          "ABC",
        ),
      "integrity",
      "projection_hash_invalid",
    ],
    [
      "mismatched projection hash",
      (response: Response) =>
        response.headers.set(
          "x-napier-agent-capability-projection-sha256",
          "b".repeat(64),
        ),
      "integrity",
      "projection_hash_mismatch",
    ],
  ])("rejects success %s", async (_name, mutate, kind, reason) => {
    const response = successResponse(projection);
    mutate(response);
    await expectResponseError(response, { kind, reason });
  });

  it("rejects invalid UTF-8, JSON, projection and Agent identity", async () => {
    const invalidUtf8 = new Uint8Array([0xff]);
    await expectResponseError(
      new Response(invalidUtf8, {
        status: 200,
        headers: successHeaders(projection, invalidUtf8),
      }),
      { reason: "utf8_invalid" },
    );
    await expectResponseError(successResponseText("{"), {
      reason: "json_invalid",
    });
    await expectResponseError(
      successResponse({ ...projection, extra: true } as never),
      {
        reason: "projection_invalid",
      },
    );
    await expectResponseError(
      successResponse({ ...projection, agentId: "agent_other" }),
      { reason: "agent_identity_mismatch" },
    );
  });

  it.each([404, 418, 422, 503])(
    "returns a verified safe HTTP error for %s",
    async (status) => {
      const response = errorResponse(status, `Safe status ${String(status)}`);
      const error = await responseError(response);
      expect(error.data).toEqual({
        kind: "http",
        operation: "get_effective_agent_capabilities",
        status,
        code: managementHttpErrorCodeForStatus(status),
        serverMessage: `Safe status ${String(status)}`,
        contentSha256: response.headers.get("x-napier-content-sha256"),
        messageSha256: response.headers.get("x-napier-error-message-sha256"),
      });
      expect(Object.isFrozen(error.data)).toBe(true);
    },
  );

  it.each([
    [
      "body mode",
      (response: Response) =>
        response.headers.delete("x-napier-content-sha256-mode"),
      "integrity",
      "content_hash_mode_invalid",
    ],
    [
      "content hash missing",
      (response: Response) =>
        response.headers.delete("x-napier-content-sha256"),
      "integrity",
      "content_hash_missing",
    ],
    [
      "content hash invalid",
      (response: Response) =>
        response.headers.set("x-napier-content-sha256", "ABC"),
      "integrity",
      "content_hash_invalid",
    ],
    [
      "content hash",
      (response: Response) =>
        response.headers.set("x-napier-content-sha256", "b".repeat(64)),
      "integrity",
      "content_hash_mismatch",
    ],
    [
      "status missing",
      (response: Response) => response.headers.delete("x-napier-error-status"),
      "protocol",
      "error_status_missing",
    ],
    [
      "status invalid",
      (response: Response) =>
        response.headers.set("x-napier-error-status", "four"),
      "protocol",
      "error_status_invalid",
    ],
    [
      "status mismatch",
      (response: Response) =>
        response.headers.set("x-napier-error-status", "409"),
      "protocol",
      "error_status_mismatch",
    ],
    [
      "code missing",
      (response: Response) => response.headers.delete("x-napier-error-code"),
      "protocol",
      "error_code_missing",
    ],
    [
      "code invalid",
      (response: Response) =>
        response.headers.set("x-napier-error-code", "private_error"),
      "protocol",
      "error_code_invalid",
    ],
    [
      "code mismatch",
      (response: Response) =>
        response.headers.set("x-napier-error-code", "conflict"),
      "protocol",
      "error_code_mismatch",
    ],
    [
      "message hash missing",
      (response: Response) =>
        response.headers.delete("x-napier-error-message-sha256"),
      "integrity",
      "error_message_hash_missing",
    ],
    [
      "message hash invalid",
      (response: Response) =>
        response.headers.set("x-napier-error-message-sha256", "ABC"),
      "integrity",
      "error_message_hash_invalid",
    ],
    [
      "message hash mismatch",
      (response: Response) =>
        response.headers.set("x-napier-error-message-sha256", "b".repeat(64)),
      "integrity",
      "error_message_hash_mismatch",
    ],
  ])("rejects error %s", async (_name, mutate, kind, reason) => {
    const response = errorResponse(404, "Agent not found");
    mutate(response);
    const error = await responseError(response);
    expect(error.data).toMatchObject({ kind, reason });
    expect(JSON.stringify(error.data)).not.toContain("Agent not found");
  });

  it("rejects non-exact, invalid UTF-8 and invalid JSON error envelopes", async () => {
    await expectResponseError(
      errorResponseBody(404, { error: "safe", extra: true }),
      {
        reason: "error_envelope_invalid",
      },
    );
    const invalidUtf8 = new Uint8Array([0xff]);
    await expectResponseError(rawErrorResponse(404, invalidUtf8), {
      reason: "utf8_invalid",
    });
    await expectResponseError(
      rawErrorResponse(404, new TextEncoder().encode("{")),
      {
        reason: "json_invalid",
      },
    );
  });
});

function successResponse(
  value: unknown,
  headerOverrides: Record<string, string> = {},
): Response {
  const body = new TextEncoder().encode(JSON.stringify(value));
  return new Response(body, {
    status: 200,
    headers: { ...successHeaders(value, body), ...headerOverrides },
  });
}

function successResponseText(text: string): Response {
  const body = new TextEncoder().encode(text);
  return new Response(body, {
    status: 200,
    headers: successHeaders(projection, body),
  });
}

function successHeaders(
  value: unknown,
  body = new TextEncoder().encode(JSON.stringify(value)),
): Record<string, string> {
  const projectionSha256 =
    value &&
    typeof value === "object" &&
    "projectionSha256" in value &&
    typeof value.projectionSha256 === "string"
      ? value.projectionSha256
      : digest;
  return {
    "content-type": "application/json",
    "x-napier-content-sha256-mode": "body",
    "x-napier-content-sha256": sha256(body),
    "x-napier-agent-capability-projection-sha256": projectionSha256,
  };
}

function errorResponse(status: number, message: string): Response {
  return errorResponseBody(status, { error: message });
}

function errorResponseBody(status: number, value: unknown): Response {
  return rawErrorResponse(
    status,
    new TextEncoder().encode(JSON.stringify(value)),
    typeof value === "object" &&
      value !== null &&
      "error" in value &&
      typeof value.error === "string"
      ? value.error
      : "safe",
  );
}

function rawErrorResponse(
  status: number,
  body: Uint8Array,
  message = "safe",
): Response {
  return new Response(arrayBuffer(body), {
    status,
    headers: {
      "content-type": "application/json",
      "x-napier-content-sha256-mode": "body",
      "x-napier-content-sha256": sha256(body),
      "x-napier-error-status": String(status),
      "x-napier-error-code": managementHttpErrorCodeForStatus(status),
      "x-napier-error-message-sha256": sha256(
        new TextEncoder().encode(message),
      ),
    },
  });
}

async function expectResponseError(
  response: Response,
  expected: Record<string, unknown>,
): Promise<void> {
  const error = await responseError(response);
  expect(error.data).toMatchObject(expected);
}

async function responseError(
  response: Response,
): Promise<NapierManagementClientError> {
  return capturedError(
    createNapierManagementClient({
      baseUrl: "https://napier.example",
      fetch: async () => response,
    }).getEffectiveAgentCapabilities({ agentId: "agent_napier" }),
  );
}

async function expectErrorData(
  promise: Promise<unknown>,
  expected: Record<string, unknown>,
): Promise<void> {
  const error = await capturedError(promise);
  expect(error.data).toMatchObject(expected);
}

async function capturedError(
  promise: Promise<unknown>,
): Promise<NapierManagementClientError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(NapierManagementClientError);
    return error as NapierManagementClientError;
  }
  throw new Error("Expected NapierManagementClientError");
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function arrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}
