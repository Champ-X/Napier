import { realpath } from "node:fs/promises";
import type { JsonObject, RunRecord } from "@napier/contracts";
import { canonicalJson, sha256 } from "./ed25519.js";
import {
  claimRunHeadEvent,
  type RunHeadEventClaimStore,
} from "./event-idempotency.js";
import { LocalPrivateCapsuleStore } from "./local-private-capsule-store.js";
import { validateWorkspacePatchInput } from "./workspace-patch-input.js";
import type { WorkspacePatchInput } from "./workspace-patch-model.js";

interface PatchInvocation {
  schemaVersion: 1;
  threadId: string;
  runId: string;
  callId: string;
  toolDefinitionSha256: string;
  workspaceRootSha256: string;
  args: WorkspacePatchInput;
  inputSha256: string;
  contentSha256: string;
}

export interface PatchInvocationReceipt extends JsonObject {
  schemaVersion: 1;
  callId: string;
  toolDefinitionSha256: string;
  inputSha256: string;
  capsuleSha256: string;
  contentSha256: string;
}

/** Exact private input, not a redacted display or authority to repeat a write. */
export function workspacePatchInvocations(
  dataRoot: string,
): LocalPrivateCapsuleStore<PatchInvocation> {
  return new LocalPrivateCapsuleStore({
    dataRoot,
    directory: "workspace-patch-invocations",
    label: "Workspace patch invocation",
    maxObjectBytes: 512 * 1024,
    maxObjects: 512,
    maxStorageBytes: 32 * 1024 * 1024,
    contentSha256: (value) => value.contentSha256,
    parse(serialized) {
      const value = JSON.parse(serialized) as PatchInvocation;
      const { contentSha256, ...content } = value;
      if (
        value.schemaVersion !== 1 ||
        Object.keys(value).length !== 9 ||
        ![value.threadId, value.runId, value.callId].every(text) ||
        ![
          value.toolDefinitionSha256,
          value.workspaceRootSha256,
          value.inputSha256,
          contentSha256,
        ].every(hash) ||
        sha256(canonicalJson({ toolName: "apply_patch", args: value.args })) !==
          value.inputSha256 ||
        sha256(canonicalJson(content)) !== contentSha256
      )
        throw new Error("Patch invocation binding is invalid");
      validateWorkspacePatchInput(value.args);
      return value;
    },
  });
}

export async function captureWorkspacePatchInvocation(
  store: RunHeadEventClaimStore & { workspaceRoot: string; dataRoot: string },
  run: Pick<RunRecord, "id" | "threadId">,
  callId: string,
  args: unknown,
  toolDefinitionSha256: string,
): Promise<void> {
  validateWorkspacePatchInput(args);
  const content = {
    schemaVersion: 1 as const,
    threadId: run.threadId,
    runId: run.id,
    callId,
    toolDefinitionSha256,
    workspaceRootSha256: sha256(await realpath(store.workspaceRoot)),
    args: structuredClone(args) as WorkspacePatchInput,
    inputSha256: sha256(canonicalJson({ toolName: "apply_patch", args })),
  };
  const capsuleSha256 = sha256(canonicalJson(content));
  await workspacePatchInvocations(store.dataRoot).put(
    capsuleSha256,
    canonicalJson({ ...content, contentSha256: capsuleSha256 }),
  );
  const receipt = {
    schemaVersion: 1,
    callId,
    toolDefinitionSha256,
    inputSha256: content.inputSha256,
    capsuleSha256,
  };
  await claimRunHeadEvent(
    store,
    {
      threadId: run.threadId,
      runId: run.id,
      type: "workspace.patch.invocation",
      category: "tool",
      visibility: "debug",
      payload: { ...receipt, contentSha256: sha256(canonicalJson(receipt)) },
    },
    { namespace: "workspace-patch-invocation", key: `${run.id}:${callId}` },
  );
}

export function validPatchInvocationReceipt(
  value: unknown,
): value is PatchInvocationReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const receipt = value as PatchInvocationReceipt;
  const { contentSha256, ...content } = receipt;
  return (
    Object.keys(receipt).length === 6 &&
    receipt.schemaVersion === 1 &&
    text(receipt.callId) &&
    [
      receipt.toolDefinitionSha256,
      receipt.inputSha256,
      receipt.capsuleSha256,
      contentSha256,
    ].every(hash) &&
    sha256(canonicalJson(content)) === contentSha256
  );
}
function hash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}
