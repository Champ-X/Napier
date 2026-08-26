import type {
  AfterToolCallResult,
  AgentToolResult,
} from "@earendil-works/pi-agent-core";

import type { AgentToolResultLifecycle } from "./agent-tool-result-lifecycle.js";

export interface CanonicalAgentToolResult {
  readonly result: AgentToolResult<unknown>;
  readonly isError: boolean;
}

export function createAgentToolResultFinalizer(
  lifecycle: Pick<
    AgentToolResultLifecycle,
    "finalize" | "validateModelVisibleResult"
  >,
): (
  input: Parameters<AgentToolResultLifecycle["finalize"]>[0],
) => Promise<AfterToolCallResult> {
  return async ({ toolCall, result, isError }) => {
    const canonical = canonicalizeAgentToolResult({ result, isError });
    const override = await lifecycle.finalize({
      toolCall,
      result: canonical.result,
      isError: canonical.isError,
    });
    const presented = presentCanonicalAgentToolResult(canonical, override);
    lifecycle.validateModelVisibleResult(
      toolCall.name,
      presented as AgentToolResult<unknown>,
      presented.isError ?? canonical.isError,
    );
    return presented;
  };
}

/**
 * Establishes the authoritative tool-result surface before any model-visible
 * projection is created. The shell and content list are copied so later
 * presentation work cannot rewrite the result captured by Receipt/Ledger
 * handlers. Structured details remain opaque to this protocol boundary.
 */
export function canonicalizeAgentToolResult(input: {
  result: AgentToolResult<unknown>;
  isError: boolean;
}): CanonicalAgentToolResult {
  if (!input.result || !Array.isArray(input.result.content)) {
    throw new Error("Tool result content must be an array");
  }
  const content = Object.freeze(
    input.result.content.map((item) => Object.freeze({ ...item })),
  );
  const addedToolNames = input.result.addedToolNames
    ? Object.freeze([...input.result.addedToolNames])
    : undefined;
  const result = Object.freeze({
    ...input.result,
    content,
    ...(addedToolNames ? { addedToolNames } : {}),
  }) as AgentToolResult<unknown>;
  return Object.freeze({ result, isError: input.isError });
}

/**
 * Builds the model-visible projection without mutating the canonical result.
 * Today the default presentation is behavior-equivalent; future truncation or
 * dialect adapters can evolve here while durable capture keeps the canonical
 * result.
 */
export function presentCanonicalAgentToolResult(
  canonical: CanonicalAgentToolResult,
  override?: AfterToolCallResult,
): AfterToolCallResult {
  const usage = override?.usage ?? canonical.result.usage;
  const terminate = override?.terminate ?? canonical.result.terminate;
  return {
    content: override?.content ?? [...canonical.result.content],
    details: override?.details ?? canonical.result.details,
    ...(usage ? { usage } : {}),
    ...(terminate !== undefined ? { terminate } : {}),
    isError: override?.isError ?? canonical.isError,
  };
}
