import { realpath } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "./ed25519.js";
import { LocalPrivateCapsuleStore } from "./local-private-capsule-store.js";
import type { WorkspacePatchResult } from "./workspace-patch-model.js";

interface PatchRecoveryCapsule {
  kind: "napier.workspace-patch-recovery";
  schemaVersion: 1;
  callId: string;
  inputSha256: string;
  workspaceRootSha256: string;
  path: string;
  pathSha256: string;
  beforeSha256: string | null;
  afterSha256: string;
  contentSha256: string;
}

/** Private path binding only; this is never authority to replay a write. */
export class WorkspacePatchRecoveryCapsules {
  private readonly store: LocalPrivateCapsuleStore<PatchRecoveryCapsule>;

  constructor(dataRoot: string) {
    this.store = new LocalPrivateCapsuleStore({
      dataRoot,
      directory: "workspace-patch-recovery",
      label: "Workspace patch recovery",
      maxObjectBytes: 16 * 1024,
      maxObjects: 512,
      maxStorageBytes: 8 * 1024 * 1024,
      parse: parseCapsule,
      contentSha256: (capsule) => capsule.contentSha256,
    });
  }

  async put(
    workspaceRoot: string,
    callId: string,
    args: unknown,
    result: WorkspacePatchResult,
  ): Promise<string> {
    const content = {
      kind: "napier.workspace-patch-recovery" as const,
      schemaVersion: 1 as const,
      callId,
      inputSha256: sha256(canonicalJson({ toolName: "apply_patch", args })),
      workspaceRootSha256: sha256(await realpath(workspaceRoot)),
      path: result.path,
      pathSha256: result.pathSha256,
      beforeSha256: result.beforeSha256,
      afterSha256: result.afterSha256,
    };
    const contentSha256 = sha256(canonicalJson(content));
    await this.store.put(
      contentSha256,
      canonicalJson({ ...content, contentSha256 }),
    );
    return contentSha256;
  }

  read(digest: string): Promise<PatchRecoveryCapsule> {
    return this.store.read(digest);
  }
}

function parseCapsule(serialized: string): PatchRecoveryCapsule {
  const value = JSON.parse(serialized) as PatchRecoveryCapsule;
  const { contentSha256, ...content } = value;
  if (
    value.kind !== "napier.workspace-patch-recovery" ||
    value.schemaVersion !== 1 ||
    Object.keys(value).length !== 10 ||
    typeof value.callId !== "string" ||
    !value.callId ||
    value.callId.length > 256 ||
    typeof value.path !== "string" ||
    !value.path ||
    path.isAbsolute(value.path) ||
    /[\x00-\x1f\x7f]/u.test(value.path) ||
    value.path.split(/[\\/]/u).includes("..") ||
    ![
      value.inputSha256,
      value.workspaceRootSha256,
      value.pathSha256,
      value.afterSha256,
      contentSha256,
    ].every(isHash) ||
    (value.beforeSha256 !== null && !isHash(value.beforeSha256)) ||
    sha256(value.path) !== value.pathSha256 ||
    sha256(canonicalJson(content)) !== contentSha256
  )
    throw new Error("Workspace patch recovery capsule is invalid");
  return value;
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}
