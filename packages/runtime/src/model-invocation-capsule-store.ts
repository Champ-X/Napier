import type { ModelInvocationCapsuleReceipt } from "@napier/contracts";

import { canonicalJson } from "./ed25519.js";
import { LocalPrivateCapsuleStore } from "./local-private-capsule-store.js";
import {
  createModelInvocationCapsule,
  createModelInvocationCapsuleReceipt,
  MAX_MODEL_INVOCATION_CAPSULE_BYTES,
  type CreateModelInvocationCapsuleInput,
  type ModelInvocationCapsule,
  validateModelInvocationCapsule,
} from "./model-invocation-capsule.js";

export const MAX_MODEL_INVOCATION_CAPSULES = 4_096;
export const MAX_MODEL_INVOCATION_CAPSULE_STORAGE_BYTES = 128 * 1024 * 1024;

export class ModelInvocationCapsuleStore {
  private readonly capsules: LocalPrivateCapsuleStore<ModelInvocationCapsule>;
  readonly rootPath: string;

  constructor(dataRoot: string, maxObjects = MAX_MODEL_INVOCATION_CAPSULES) {
    if (
      !Number.isSafeInteger(maxObjects) ||
      maxObjects < 1 ||
      maxObjects > MAX_MODEL_INVOCATION_CAPSULES
    ) {
      throw new Error("Model invocation capsule object limit is invalid");
    }
    this.capsules = new LocalPrivateCapsuleStore({
      dataRoot,
      directory: "model-invocations",
      label: "Model invocation",
      maxObjectBytes: MAX_MODEL_INVOCATION_CAPSULE_BYTES,
      maxObjects,
      maxStorageBytes: MAX_MODEL_INVOCATION_CAPSULE_STORAGE_BYTES,
      parse(serialized) {
        return validateModelInvocationCapsule(JSON.parse(serialized));
      },
      contentSha256(capsule) {
        return capsule.contentSha256;
      },
    });
    this.rootPath = this.capsules.rootPath;
  }

  async put(
    input: CreateModelInvocationCapsuleInput,
  ): Promise<ModelInvocationCapsuleReceipt> {
    const capsule = createModelInvocationCapsule(input);
    const stored = await this.capsules.put(
      capsule.contentSha256,
      canonicalJson(capsule),
    );
    return createModelInvocationCapsuleReceipt(stored.value, stored.bytes);
  }

  read(capsuleSha256: string): Promise<ModelInvocationCapsule> {
    return this.capsules.read(capsuleSha256);
  }
}
