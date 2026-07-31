import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type {
  ToolInvocationCapsuleReceipt,
  ToolInvocationResultCapsuleReceipt,
} from "@napier/contracts";

import { canonicalJson } from "./ed25519.js";
import { LocalPrivateCapsuleStore } from "./local-private-capsule-store.js";
import {
  createToolInvocationResultCapsule,
  createToolInvocationResultCapsuleReceipt,
  MAX_TOOL_INVOCATION_RESULT_CAPSULE_BYTES,
  type ToolInvocationResultCapsule,
  validateToolInvocationResultCapsule,
} from "./tool-invocation-result-capsule.js";

export const MAX_TOOL_INVOCATION_RESULT_CAPSULES = 512;
export const MAX_TOOL_INVOCATION_RESULT_CAPSULE_STORAGE_BYTES =
  128 * 1024 * 1024;

export class ToolInvocationResultCapsuleStore {
  private readonly capsules: LocalPrivateCapsuleStore<ToolInvocationResultCapsule>;
  readonly rootPath: string;

  constructor(dataRoot: string) {
    this.capsules = new LocalPrivateCapsuleStore({
      dataRoot,
      directory: "tool-invocation-results",
      label: "Tool invocation result",
      maxObjectBytes: MAX_TOOL_INVOCATION_RESULT_CAPSULE_BYTES,
      maxObjects: MAX_TOOL_INVOCATION_RESULT_CAPSULES,
      maxStorageBytes: MAX_TOOL_INVOCATION_RESULT_CAPSULE_STORAGE_BYTES,
      parse(serialized) {
        return validateToolInvocationResultCapsule(JSON.parse(serialized));
      },
      contentSha256(capsule) {
        return capsule.contentSha256;
      },
    });
    this.rootPath = this.capsules.rootPath;
  }

  async put(input: {
    sourceThreadId: string;
    sourceRunId: string;
    invocation: ToolInvocationCapsuleReceipt;
    result: AgentToolResult<unknown>;
    isError: boolean;
  }): Promise<ToolInvocationResultCapsuleReceipt> {
    const capsule = createToolInvocationResultCapsule(input);
    const stored = await this.capsules.put(
      capsule.contentSha256,
      canonicalJson(capsule),
    );
    return createToolInvocationResultCapsuleReceipt(stored.value, stored.bytes);
  }

  read(capsuleSha256: string): Promise<ToolInvocationResultCapsule> {
    return this.capsules.read(capsuleSha256);
  }
}
