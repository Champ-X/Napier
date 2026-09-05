import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { CapabilityDescriptor } from "@napier/contracts/tool-protocol";

import {
  createOwnedToolRecordV2,
  type OwnedToolRecordV2,
} from "./owned-tool-protocol.js";

export {
  createOwnedToolRecordV2,
  toolProtocolDefinitionSha256,
  validateToolDefinitionV2,
} from "./owned-tool-protocol.js";
export type { OwnedToolRecordV2 } from "./owned-tool-protocol.js";

/** Collection and lookup boundary for already-owned Tool Protocol records. */
export class ToolProtocolRegistry {
  private readonly records = new Map<string, OwnedToolRecordV2>();
  private readonly capabilityOwners = new Map<string, string>();

  constructor(tools: readonly AgentTool[]) {
    for (const tool of tools) {
      if (this.records.has(tool.name)) {
        throw new Error(`Tool Protocol tool ID is duplicated: ${tool.name}`);
      }
      const record = createOwnedToolRecordV2(tool);
      for (const uri of record.definition.capabilityUris) {
        const owner = this.capabilityOwners.get(uri);
        if (owner) {
          throw new Error(
            `Tool Protocol capability URI is duplicated: ${uri} (${owner}, ${tool.name})`,
          );
        }
        this.capabilityOwners.set(uri, tool.name);
      }
      this.records.set(tool.name, record);
    }
  }

  get(toolId: string): OwnedToolRecordV2 | undefined {
    return this.records.get(toolId);
  }

  require(toolId: string): OwnedToolRecordV2 {
    const record = this.records.get(toolId);
    if (!record) {
      throw new Error(`Tool Protocol definition is unavailable: ${toolId}`);
    }
    return record;
  }

  descriptors(): CapabilityDescriptor[] {
    return [...this.records.values()]
      .filter(({ tool }) => tool.name !== "capability")
      .flatMap(({ tool, definition, definitionSha256 }) =>
        definition.capabilityUris.map((uri) =>
          Object.freeze({
            kind: "napier.capability-descriptor" as const,
            schemaVersion: 1 as const,
            uri,
            toolId: definition.id,
            label: tool.label,
            description: tool.description,
            definition,
            definitionSha256,
          }),
        ),
      )
      .sort(
        (left, right) =>
          left.toolId.localeCompare(right.toolId) ||
          left.uri.localeCompare(right.uri),
      );
  }

  matchesDefinitionSha256(toolId: string, expected: string): boolean {
    return Boolean(
      this.records.get(toolId)?.matchesDefinitionSha256(expected),
    );
  }
}
