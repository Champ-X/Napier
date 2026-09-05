import type { ToolInvocationProtocolV2 } from "@napier/contracts/tool-protocol";

import type {
  ToolConcurrencyOperation,
  ToolConcurrencyResourceKey,
} from "./tool-concurrency-gate.js";

/**
 * Maps semantic Tool Protocol scope to a private scheduling resource. The
 * operation never depends on a display name: tools with equivalent scope and
 * bindings contend on the same resource even when their implementations differ.
 */
export function toolConcurrencyOperation(
  operationId: string,
  protocol: ToolInvocationProtocolV2,
): ToolConcurrencyOperation {
  const mode = effectiveConcurrency(protocol);
  const primary = concurrencyResource(protocol);
  const session = protocol.progress.failureBindings?.session;
  return {
    operationId,
    requirements: [
      { key: primary, mode },
      ...(session && protocol.progress.scope !== "session"
        ? [{ key: ["run", "session", session], mode } as const]
        : []),
    ],
  };
}

/**
 * A trusted progress resolver may narrow one multi-action tool to a concrete
 * mutation only after its arguments are known. Mutations must exclude both
 * readers and writers in the same semantic resource even when the tool-level
 * fallback is merely serialized. This rule applies to every present and future
 * tool; individual tool names never participate in scheduling.
 */
function effectiveConcurrency(
  protocol: ToolInvocationProtocolV2,
): ToolInvocationProtocolV2["concurrency"] {
  return protocol.progress.operation === "mutate"
    ? "exclusive"
    : protocol.concurrency;
}

function concurrencyResource(
  protocol: ToolInvocationProtocolV2,
): ToolConcurrencyResourceKey {
  const progress = protocol.progress;
  const binding = concurrencyBinding(progress);
  switch (progress.scope) {
    case "workspace":
      // Workspace readers, patchers, Git, LSP and verifiers must agree on one
      // mutation boundary even when their private path bindings differ.
      return ["run", "workspace"];
    case "session":
      return ["run", "session", binding ?? "unbound"];
    case "external":
    case "remote":
      return ["run", progress.scope, binding ?? "unbound"];
    case "run_source":
      return ["run", "run_source"];
    case "control":
      return ["run", "control"];
    case "neutral":
      // Unknown effects retain the original whole-Run exclusion domain.
      return ["run"];
  }
}

function concurrencyBinding(
  progress: ToolInvocationProtocolV2["progress"],
): string | undefined {
  if (progress.scope === "session") {
    return (
      progress.failureBindings?.session ??
      progress.failureDomainKeySha256 ??
      progress.resourceKeySha256
    );
  }
  return (
    progress.failureBindings?.origin ??
    progress.failureBindings?.route ??
    progress.failureDomainKeySha256 ??
    progress.resourceKeySha256
  );
}
