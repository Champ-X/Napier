import type { JsonObject, RunEvent } from "@napier/contracts";
import type { ToolProgressResolution } from "../src/tool-progress-semantics.js";
import { describe, expect, it } from "vitest";

import { resolveBrowserToolProgress } from "../src/browser-tool-progress.js";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import {
  guardRunFailureCircuit,
  projectRunFailureCircuits,
} from "../src/run-failure-circuit-projection.js";
import type { RunConvergenceToolProgress } from "../src/run-convergence-tool-progress.js";
import {
  bindToolOperationDescriptor,
  stableOperationBinding,
} from "../src/tool-operation-binding.js";

describe("built-in failure bindings", () => {
  it("treats remote Browser mutations as private, target-bound product progress", () => {
    const first = progress(
      resolveBrowserToolProgress({
        action: "type",
        target: { selector: "#private-email" },
        text: "first-private-value",
      }),
    );
    const repeatedWithDifferentSecret = progress(
      resolveBrowserToolProgress({
        action: "type",
        target: { selector: "#private-email" },
        text: "second-private-value",
      }),
    );
    const distinctTarget = progress(
      resolveBrowserToolProgress({
        action: "type",
        target: { selector: "#other-field" },
        text: "first-private-value",
      }),
    );

    expect(first).toEqual(
      expect.objectContaining({
        operation: "mutate",
        contribution: "product",
        resourceKeySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(repeatedWithDifferentSecret.resourceKeySha256).toBe(
      first.resourceKeySha256,
    );
    expect(distinctTarget.resourceKeySha256).not.toBe(
      first.resourceKeySha256,
    );
    expect(JSON.stringify(first)).not.toContain("private-email");
    expect(JSON.stringify(first)).not.toContain("private-value");
  });

  it("blocks an inactive interactive Browser Session across origins", () => {
    const first = progress(
      resolveBrowserToolProgress({
        action: "navigate",
        url: "https://one.example/page",
      }),
    );
    const second = progress(
      resolveBrowserToolProgress({
        action: "navigate",
        url: "https://two.example/page",
      }),
    );

    expect(first.failureBindings?.origin).not.toBe(
      second.failureBindings?.origin,
    );
    expect(first.failureBindings?.session).toBe(
      second.failureBindings?.session,
    );

    const projection = projectRunFailureCircuits(
      [failedBrowserEvent(first, "session_state", "session")],
      "run_browser_session_binding",
    );
    expect(guardRunFailureCircuit(projection, second, Date.now())).toEqual(
      expect.objectContaining({ scope: "session", blocks: true }),
    );
  });

  it("uses a scope-specific route binding before the legacy catch-all", () => {
    const sharedLegacy = "f".repeat(64);
    const routeA = "a".repeat(64);
    const routeB = "b".repeat(64);
    const first: RunConvergenceToolProgress = {
      availability: "declared",
      coverage: "trusted_declared",
      operation: "acquire",
      contribution: "supporting",
      resourceKeySha256: "c".repeat(64),
      failureBindings: { route: routeA },
      failureDomainKeySha256: sharedLegacy,
    };
    const projection = projectRunFailureCircuits(
      [failedBrowserEvent(first, "forbidden", "route")],
      "run_browser_session_binding",
    );

    expect(
      guardRunFailureCircuit(
        projection,
        { ...first, failureBindings: { route: routeB } },
        Date.now(),
      ),
    ).toBeUndefined();
    expect(guardRunFailureCircuit(projection, first, Date.now())).toEqual(
      expect.objectContaining({ scope: "route", blocks: true }),
    );
  });

  it("replays historical receipts that only contain failureDomainKeySha256", () => {
    const legacy: RunConvergenceToolProgress = {
      availability: "declared",
      coverage: "trusted_declared",
      operation: "acquire",
      contribution: "supporting",
      resourceKeySha256: "c".repeat(64),
      failureDomainKeySha256: "d".repeat(64),
    };
    const projection = projectRunFailureCircuits(
      [failedBrowserEvent(legacy, "forbidden", "route")],
      "run_browser_session_binding",
    );

    expect(guardRunFailureCircuit(projection, legacy, Date.now())).toEqual(
      expect.objectContaining({ scope: "route", blocks: true }),
    );
  });

  it("does not change descriptor hashes when new bindings are absent", () => {
    const descriptor = {
      ordinal: 1,
      mode: "legacy",
      route: "fixture",
      operation: "acquire" as const,
      scope: "external" as const,
      contribution: "supporting" as const,
      resourceKey: { resource: "one" },
      failureDomainKey: { domain: "legacy" },
    };
    const binding = bindToolOperationDescriptor("call_legacy", descriptor);
    const expectedDescriptor = {
      ordinal: 1,
      mode: "legacy",
      route: "fixture",
      operation: "acquire",
      scope: "external",
      contribution: "supporting",
      resourceKeySha256: stableOperationBinding(descriptor.resourceKey),
      failureDomainKeySha256: stableOperationBinding(
        descriptor.failureDomainKey,
      ),
    };

    expect(binding.failureBindings).toBeUndefined();
    expect(binding.descriptorSha256).toBe(
      sha256(canonicalJson(expectedDescriptor)),
    );
    expect(binding.operationId).toBe(
      `operation_${sha256(
        canonicalJson({ parentCallId: "call_legacy", ...expectedDescriptor }),
      ).slice(0, 32)}`,
    );
  });
});

function progress(
  resolution: ToolProgressResolution,
): RunConvergenceToolProgress {
  const resourceKeySha256 = stableOperationBinding(resolution.resourceKey);
  const failureDomainKeySha256 = stableOperationBinding(
    resolution.failureDomainKey,
  );
  const failureBindings = Object.fromEntries(
    Object.entries(resolution.failureBindings ?? {}).flatMap(
      ([scope, binding]) => {
        const digest = stableOperationBinding(binding);
        return digest ? [[scope, digest]] : [];
      },
    ),
  );
  return {
    availability: "declared",
    coverage: "trusted_declared",
    operation: resolution.semantics.operation,
    contribution: resolution.semantics.contribution,
    ...(resourceKeySha256 ? { resourceKeySha256 } : {}),
    ...(Object.keys(failureBindings).length > 0 ? { failureBindings } : {}),
    ...(failureDomainKeySha256 ? { failureDomainKeySha256 } : {}),
  };
}

function failedBrowserEvent(
  progressReceipt: RunConvergenceToolProgress,
  failureClass: "forbidden" | "session_state",
  scope: "route" | "session",
): RunEvent {
  return {
    id: "event_browser_failure",
    threadId: "thread_browser_failure",
    runId: "run_browser_session_binding",
    seq: 1,
    type: "tool.failed",
    category: "debug",
    visibility: "hidden",
    createdAt: "2026-09-03T12:00:00.000Z",
    payload: {
      callId: "call_browser_failure",
      toolName: "browser",
      toolProtocol: {
        progress: {
          kind: "napier.tool-progress-semantics",
          schemaVersion: 1,
          scope: "external",
          ...progressReceipt,
        },
      },
      toolFailure: {
        class: failureClass,
        scope,
        disposition: scope === "session" ? "recover_state" : "alternate_route",
        fatalToSession: scope === "session",
        diagnosticSha256: sha256(`${failureClass}:${scope}`),
      },
    } as JsonObject,
    schemaVersion: 1,
  };
}
