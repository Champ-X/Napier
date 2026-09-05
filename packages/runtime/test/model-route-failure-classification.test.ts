import { describe, expect, it } from "vitest";

import { attestHostModelAbort } from "../src/model-abort-provenance.js";
import { ModelRouteFailureError } from "../src/model-route-failure-classification.js";
import { classifyRouteAttemptFailure } from "../src/model-route-provider-evidence.js";
import { classifyRouteFailure } from "../src/model-route-policy.js";

describe("Model route structured failure classification", () => {
  it.each([
    [{ status: 429, message: "请求过于频繁" }, "rate_limited"],
    [{ code: "ECONNRESET", message: "连接被远端关闭" }, "network"],
    [{ response: { status: 503 }, message: "上游暂不可用" }, "provider_server"],
    [{ type: "context_length_exceeded", message: "输入过长" }, "context"],
  ] as const)(
    "classifies locale-independent provider evidence",
    (error, expected) => {
      expect(classifyRouteFailure(error)).toBe(expected);
    },
  );

  it("honors a typed signal before diagnostic wording", () => {
    expect(
      classifyRouteFailure(
        new ModelRouteFailureError("rate limit timeout", "tool_dialect"),
      ),
    ).toBe("tool_dialect");
  });

  it("fails closed on a malformed typed signal without text fallback", () => {
    expect(
      classifyRouteFailure({
        routeFailure: {
          kind: "napier.model-route-failure-signal",
          schemaVersion: 99,
          failureClass: "rate_limited",
        },
        message: "rate limit exceeded",
      }),
    ).toBe("unknown");
  });

  it("distinguishes caller cancellation from a provider-side abort", () => {
    const providerAbort = Object.assign(new Error("aborted"), {
      name: "AbortError",
    });
    expect(classifyRouteAttemptFailure(providerAbort, false)).toBe("network");
    expect(classifyRouteAttemptFailure(providerAbort, true)).toBe("cancelled");
  });

  it("does not retry a host watchdog abort as a provider network failure", () => {
    const message = attestHostModelAbort(
      {
        role: "assistant",
        content: [],
        api: "test-api",
        provider: "test-provider",
        model: "test-model",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0,
          },
        },
        stopReason: "aborted",
        errorMessage: "provider-looking text must not override host ownership",
        timestamp: 0,
      },
      {
        owner: "watchdog",
        evidence: {
          reason: "semantic_progress_timeout",
          limitMs: 200,
          turnTimeoutMs: 1_000,
          firstEventTimeoutMs: 100,
          idleTimeoutMs: 300,
          semanticProgressTimeoutMs: 200,
        },
      },
    );

    expect(classifyRouteAttemptFailure(message, false)).toBe("cancelled");
  });

  it("keeps message parsing as an explicit legacy fallback", () => {
    expect(classifyRouteFailure(new Error("Service unavailable"))).toBe(
      "provider_server",
    );
    expect(classifyRouteFailure(new Error("服务暂不可用"))).toBe("unknown");
  });

  it.each([
    ["HTTP 408 请求超时", "network"],
    ["upstream returned HTTP/1.1 429", "rate_limited"],
    ["HTTP status code: 503 上游不可用", "provider_server"],
  ] as const)(
    "preserves flattened protocol status evidence in %s",
    (diagnostic, expected) => {
      expect(classifyRouteFailure(new Error(diagnostic))).toBe(expected);
    },
  );

  it.each(["provider error 408", "HTTP result 408", "ticket HTTP4087"])(
    "does not infer HTTP status from ambiguous diagnostic %s",
    (diagnostic) => {
      expect(classifyRouteFailure(new Error(diagnostic))).toBe("unknown");
    },
  );
});
