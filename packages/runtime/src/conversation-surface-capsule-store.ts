import type {
  AssistantMessage,
  ToolResultMessage,
} from "@earendil-works/pi-ai";

import { canonicalJson } from "./ed25519.js";
import { LocalPrivateCapsuleStore } from "./local-private-capsule-store.js";
import {
  createConversationSurfaceCapsule,
  createConversationSurfaceCapsuleReceipt,
  MAX_CONVERSATION_SURFACE_CAPSULE_BYTES,
  type ConversationSurfaceCapsule,
  type ConversationSurfaceCapsuleReceipt,
  validateConversationSurfaceCapsule,
} from "./conversation-surface-capsule.js";

export const MAX_CONVERSATION_SURFACE_CAPSULES = 4_096;
export const MAX_CONVERSATION_SURFACE_CAPSULE_STORAGE_BYTES = 128 * 1024 * 1024;

export class ConversationSurfaceCapsuleStore {
  private readonly capsules: LocalPrivateCapsuleStore<ConversationSurfaceCapsule>;
  readonly rootPath: string;

  constructor(
    dataRoot: string,
    maxObjects = MAX_CONVERSATION_SURFACE_CAPSULES,
  ) {
    if (
      !Number.isSafeInteger(maxObjects) ||
      maxObjects < 1 ||
      maxObjects > MAX_CONVERSATION_SURFACE_CAPSULES
    ) {
      throw new Error("Conversation Surface capsule object limit is invalid");
    }
    this.capsules = new LocalPrivateCapsuleStore({
      dataRoot,
      directory: "conversation-surfaces",
      label: "Conversation Surface",
      maxObjectBytes: MAX_CONVERSATION_SURFACE_CAPSULE_BYTES,
      maxObjects,
      maxStorageBytes: MAX_CONVERSATION_SURFACE_CAPSULE_STORAGE_BYTES,
      parse(serialized) {
        return validateConversationSurfaceCapsule(JSON.parse(serialized));
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
    modelContextEnvelopeSha256: string;
    modelContextEnvelopeTurnIndex: number;
    assistant: AssistantMessage;
    toolResults: ToolResultMessage[];
  }): Promise<ConversationSurfaceCapsuleReceipt> {
    const capsule = createConversationSurfaceCapsule(input);
    const stored = await this.capsules.put(
      capsule.contentSha256,
      canonicalJson(capsule),
    );
    return createConversationSurfaceCapsuleReceipt(stored.value, stored.bytes);
  }

  read(capsuleSha256: string): Promise<ConversationSurfaceCapsule> {
    return this.capsules.read(capsuleSha256);
  }
}
