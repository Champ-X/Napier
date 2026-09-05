import type { AgentTool } from "@earendil-works/pi-agent-core";

import { canonicalJson, sha256 } from "./ed25519.js";

export type AgentToolMetadataTransfer = (
  source: AgentTool,
  target: AgentTool,
) => void;

const metadataTransfers = new Set<AgentToolMetadataTransfer>();
const decorationSourceHashes = new WeakMap<AgentTool, string>();

/**
 * Registers one identity-bound metadata family with the common decorator
 * boundary. Metadata owners keep validation and storage private; wrappers no
 * longer need to know which protocol declarations happen to use WeakMaps.
 */
export function registerAgentToolMetadataTransfer(
  transfer: AgentToolMetadataTransfer,
): void {
  metadataTransfers.add(transfer);
}

/**
 * Marks a wrapper as the same logical tool while retaining its new executable
 * implementation identity. The name cannot change across this boundary:
 * renaming creates a different tool and requires a new protocol declaration.
 */
export function preserveAgentToolIdentity<T extends AgentTool>(
  source: AgentTool,
  target: T,
): T {
  if (source === target) return target;
  if (source.name !== target.name) {
    throw new Error("Agent tool identity cannot be preserved across a rename");
  }
  const sourceDecorationSha256 = decorationSourceHashes.get(source);
  if (source.execute !== target.execute) {
    decorationSourceHashes.set(target, agentToolImplementationSha256(source));
  } else if (sourceDecorationSha256) {
    decorationSourceHashes.set(target, sourceDecorationSha256);
  }
  // Provenance is part of implementation identity. Establish it before
  // metadata owners re-attest the target so their digests see the final value.
  for (const transfer of metadataTransfers) transfer(source, target);
  return target;
}

/**
 * Content-addresses both a tool's visible executable fields and any immutable
 * source implementation captured by an identity-preserving decorator.
 */
export function agentToolImplementationSha256(
  tool: Pick<
    AgentTool,
    "name" | "description" | "parameters" | "prepareArguments" | "execute"
  >,
): string {
  const decorationSourceSha256 = decorationSourceHashes.get(tool as AgentTool);
  return sha256(
    canonicalJson({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      prepareArgumentsSha256: sha256(
        tool.prepareArguments
          ? Function.prototype.toString.call(tool.prepareArguments)
          : "",
      ),
      executeSha256: sha256(Function.prototype.toString.call(tool.execute)),
      ...(decorationSourceSha256 ? { decorationSourceSha256 } : {}),
    }),
  );
}
