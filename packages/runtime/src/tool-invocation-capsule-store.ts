import type { ToolInvocationCapsuleReceipt } from "@napier/contracts";

import { canonicalJson } from "./ed25519.js";
import { LocalPrivateCapsuleStore } from "./local-private-capsule-store.js";
import {
  createToolInvocationCapsule,
  createToolInvocationCapsuleReceipt,
  MAX_TOOL_INVOCATION_CAPSULE_BYTES,
  type CreateToolInvocationCapsuleInput,
  type ToolInvocationCapsule,
  validateToolInvocationCapsule,
} from "./tool-invocation-capsule.js";

export const MAX_TOOL_INVOCATION_CAPSULES = 512;
export const MAX_TOOL_INVOCATION_CAPSULE_STORAGE_BYTES = 64 * 1024 * 1024;

export class ToolInvocationCapsuleStore {
  private readonly capsules: LocalPrivateCapsuleStore<ToolInvocationCapsule>;
  readonly rootPath: string;

  constructor(dataRoot: string) {
    this.capsules = new LocalPrivateCapsuleStore({
      dataRoot,
      directory: "tool-invocations",
      label: "Tool invocation",
      maxObjectBytes: MAX_TOOL_INVOCATION_CAPSULE_BYTES,
      maxObjects: MAX_TOOL_INVOCATION_CAPSULES,
      maxStorageBytes: MAX_TOOL_INVOCATION_CAPSULE_STORAGE_BYTES,
      parse(serialized) {
        return validateToolInvocationCapsule(JSON.parse(serialized));
      },
      contentSha256(capsule) {
        return capsule.contentSha256;
      },
    });
    this.rootPath = this.capsules.rootPath;
  }

  async put(
    input: CreateToolInvocationCapsuleInput,
  ): Promise<ToolInvocationCapsuleReceipt> {
    const capsule = createToolInvocationCapsule(input);
    const stored = await this.capsules.put(
      capsule.contentSha256,
      canonicalJson(capsule),
    );
    return createToolInvocationCapsuleReceipt(stored.value, stored.bytes);
  }

  read(capsuleSha256: string): Promise<ToolInvocationCapsule> {
    return this.capsules.read(capsuleSha256);
  }
}
