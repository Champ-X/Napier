import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ToolFailureReceiptV1 } from "@napier/contracts/tool-protocol";

import { preserveAgentToolIdentity } from "./agent-tool-metadata.js";
import type { ToolProtocolRegistry } from "./tool-protocol-registry.js";

/** Captures the original thrown value before Pi converts it to display text. */
export function wrapToolsWithFailureCapture(input: {
  tools: AgentTool[];
  protocols: ToolProtocolRegistry;
  captured(callId: string, receipt: ToolFailureReceiptV1): void;
}): void {
  for (let index = 0; index < input.tools.length; index += 1) {
    const tool = input.tools[index]!;
    input.tools[index] = preserveAgentToolIdentity(tool, {
      ...tool,
      execute: async (callId, args, signal, onUpdate) => {
        try {
          return await tool.execute(callId, args, signal, onUpdate);
        } catch (error) {
          input.captured(
            callId,
            input.protocols.require(tool.name).failure(args, error),
          );
          throw error;
        }
      },
    });
  }
}
