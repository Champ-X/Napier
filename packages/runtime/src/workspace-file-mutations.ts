import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rmdir,
  unlink,
} from "node:fs/promises";
import path from "node:path";

import type {
  JsonValue,
  WorkspaceFileMutationEvidence,
  WorkspaceFileMutationOperation,
  WorkspaceTrashItem,
  WorkspaceTrashList,
  WorkspaceTrashRestoreResult,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import { createId } from "./ids.js";
import type { LocalStore } from "./store.js";
import {
  compareDirectoryEntries,
  createMissingDirectories,
  createTrashItem,
  errorCode,
  inspectAbsoluteEntry,
  inspectMissingAbsolutePath,
  inspectMissingPath,
  inspectWorkspaceEntry,
  normalizeMutationPath,
  parseTrashItem,
  scopeFromSnapshot,
  syncDirectory,
  type MissingPathPlan,
  type WorkspaceEntrySnapshot,
  type WorkspaceFileMutationScope,
  writeJsonExclusive,
} from "./workspace-file-scope.js";
import { withWorkspacePathLocks } from "./workspace-write-lock.js";

export const MAX_WORKSPACE_FILE_MUTATION_PREVIEWS = 64;
export const WORKSPACE_FILE_MUTATION_PREVIEW_TTL_MS = 5 * 60_000;
export {
  MAX_WORKSPACE_FILE_MUTATION_BYTES,
  MAX_WORKSPACE_FILE_MUTATION_ENTRIES,
} from "./workspace-file-scope.js";

const PREVIEW_ID = /^filepreview_[a-z0-9]{8,80}$/u;
const TRASH_ID = /^trash_[a-z0-9]{8,80}$/u;

export type WorkspaceFileMutationRequest =
  | {
      operation: "create_directory";
      path: string;
      createParentDirectories?: boolean;
    }
  | {
      operation: "move";
      sourcePath: string;
      destinationPath: string;
    }
  | {
      operation: "trash";
      path: string;
    }
  | {
      operation: "restore";
      trashId: string;
    };

export type { WorkspaceFileMutationScope } from "./workspace-file-scope.js";

export interface WorkspaceFileMutationPreview {
  kind: "napier.workspace-file-mutation-preview";
  schemaVersion: 1;
  id: string;
  threadId: string;
  runId: string;
  operation: WorkspaceFileMutationOperation;
  sourcePath?: string;
  destinationPath?: string;
  trashId?: string;
  scope?: WorkspaceFileMutationScope;
  createdDirectoryCount?: number;
  reversible: boolean;
  expiresAt: string;
  planSha256: string;
}

export interface WorkspaceFileMutationApplyResult {
  kind: "napier.workspace-file-mutation-result";
  schemaVersion: 1;
  sourcePath?: string;
  destinationPath?: string;
  trashItem?: WorkspaceTrashItem;
  evidence: WorkspaceFileMutationEvidence;
}

export interface WorkspaceFileMutationManagerOptions {
  store: LocalStore;
  workspaceRoot: string;
  dataRoot: string;
  renameEntry?: typeof rename;
  now?: () => Date;
}

interface WorkspaceFileMutationPlan {
  request: WorkspaceFileMutationRequest;
  sourcePath?: string;
  destinationPath?: string;
  source?: WorkspaceEntrySnapshot;
  destination: MissingPathPlan;
  trashId?: string;
  trashItem?: WorkspaceTrashItem;
  lockTargets: string[];
  reversible: boolean;
  planSha256: string;
}

interface StoredPreview {
  preview: WorkspaceFileMutationPreview;
  request: WorkspaceFileMutationRequest;
  trashId?: string;
  createdAtMs: number;
}

export class WorkspaceFileMutationManager {
  private readonly previews = new Map<string, StoredPreview>();
  private readonly workspaceRoot: string;
  private readonly dataRoot: string;
  private readonly trashRoot: string;
  private readonly renameEntry: typeof rename;
  private readonly currentTime: () => Date;
  private initialized = false;

  constructor(private readonly options: WorkspaceFileMutationManagerOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.dataRoot = path.resolve(options.dataRoot);
    this.trashRoot = path.join(this.dataRoot, "workspace-trash");
    this.renameEntry = options.renameEntry ?? rename;
    this.currentTime = options.now ?? (() => new Date());
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.workspaceRoot, { recursive: true });
    await Promise.all([
      realpath(this.workspaceRoot),
      mkdir(this.trashRoot, { recursive: true, mode: 0o700 }),
    ]);
    this.initialized = true;
  }

  async preview(
    threadId: string,
    runId: string,
    request: WorkspaceFileMutationRequest,
    signal?: AbortSignal,
  ): Promise<WorkspaceFileMutationPreview> {
    this.assertReady();
    this.assertRunOwner(threadId, runId);
    assertNotAborted(signal, "Workspace file mutation preview was aborted");
    this.prunePreviews();
    const trashId =
      request.operation === "trash" ? createId("trash") : undefined;
    const plan = await this.buildPlan(request, trashId);
    assertNotAborted(signal, "Workspace file mutation preview was aborted");
    const now = this.validNow();
    const previewId = createId("filepreview");
    const preview: WorkspaceFileMutationPreview = {
      kind: "napier.workspace-file-mutation-preview",
      schemaVersion: 1,
      id: previewId,
      threadId,
      runId,
      operation: request.operation,
      ...(plan.sourcePath ? { sourcePath: plan.sourcePath } : {}),
      ...(plan.destinationPath
        ? { destinationPath: plan.destinationPath }
        : {}),
      ...(plan.trashId ? { trashId: plan.trashId } : {}),
      ...(plan.source ? { scope: scopeFromSnapshot(plan.source) } : {}),
      ...(plan.destination.missingDirectories.length > 0
        ? {
            createdDirectoryCount: plan.destination.missingDirectories.length,
          }
        : {}),
      reversible: plan.reversible,
      expiresAt: new Date(
        now.getTime() + WORKSPACE_FILE_MUTATION_PREVIEW_TTL_MS,
      ).toISOString(),
      planSha256: plan.planSha256,
    };
    this.previews.set(previewId, {
      preview,
      request: structuredClone(request),
      ...(trashId ? { trashId } : {}),
      createdAtMs: now.getTime(),
    });
    this.prunePreviews();
    return structuredClone(preview);
  }

  async apply(
    threadId: string,
    runId: string,
    previewId: string,
    initiatedBy: WorkspaceFileMutationEvidence["initiatedBy"] = "agent",
    signal?: AbortSignal,
  ): Promise<WorkspaceFileMutationApplyResult> {
    this.assertReady();
    this.assertRunOwner(threadId, runId);
    if (!PREVIEW_ID.test(previewId)) {
      throw new Error("Workspace file mutation preview ID is invalid");
    }
    this.prunePreviews();
    const stored = this.previews.get(previewId);
    if (
      !stored ||
      stored.preview.threadId !== threadId ||
      stored.preview.runId !== runId
    ) {
      throw new Error("Workspace file mutation preview not found");
    }
    if (Date.parse(stored.preview.expiresAt) <= this.validNow().getTime()) {
      this.previews.delete(previewId);
      throw new Error("Workspace file mutation preview expired");
    }
    assertNotAborted(signal, "Workspace file mutation apply was aborted");
    this.previews.delete(previewId);
    const initialPlan = await this.buildPlan(stored.request, stored.trashId);
    if (initialPlan.planSha256 !== stored.preview.planSha256) {
      throw new Error(
        "Workspace file mutation preview is stale; preview the operation again",
      );
    }
    assertNotAborted(signal, "Workspace file mutation apply was aborted");
    return withWorkspacePathLocks(
      this.dataRoot,
      initialPlan.lockTargets,
      "workspace file mutation",
      async () => {
        assertNotAborted(signal, "Workspace file mutation apply was aborted");
        const currentPlan = await this.buildPlan(
          stored.request,
          stored.trashId,
        );
        if (currentPlan.planSha256 !== stored.preview.planSha256) {
          throw new Error(
            "Workspace file mutation preview is stale; preview the operation again",
          );
        }
        const applied = await this.commitPlan(currentPlan, threadId, runId);
        const evidence = await this.recordMutation(
          threadId,
          runId,
          initiatedBy,
          currentPlan,
          applied,
        );
        return {
          kind: "napier.workspace-file-mutation-result",
          schemaVersion: 1,
          ...(currentPlan.sourcePath
            ? { sourcePath: currentPlan.sourcePath }
            : {}),
          ...(currentPlan.destinationPath
            ? { destinationPath: currentPlan.destinationPath }
            : {}),
          ...(applied.trashItem ? { trashItem: applied.trashItem } : {}),
          evidence,
        };
      },
    );
  }

  async listTrash(threadId: string): Promise<WorkspaceTrashList> {
    this.assertReady();
    this.options.store.getThread(threadId);
    const items: WorkspaceTrashItem[] = [];
    const children = await readdir(this.trashRoot, { withFileTypes: true });
    children.sort(compareDirectoryEntries);
    for (const child of children) {
      if (!child.isDirectory() || !TRASH_ID.test(child.name)) continue;
      const item = await this.readTrashItem(child.name).catch(() => undefined);
      if (item?.threadId === threadId) items.push(item);
    }
    items.sort((left, right) => right.trashedAt.localeCompare(left.trashedAt));
    return {
      kind: "napier.workspace-trash-list",
      schemaVersion: 1,
      threadId,
      items,
    };
  }

  async restoreTrash(
    threadId: string,
    trashId: string,
    signal?: AbortSignal,
  ): Promise<WorkspaceTrashRestoreResult> {
    this.assertReady();
    const item = await this.readTrashItem(trashId);
    if (item.threadId !== threadId) {
      throw new Error("Workspace trash item not found");
    }
    const preview = await this.preview(
      threadId,
      item.runId,
      { operation: "restore", trashId },
      signal,
    );
    const result = await this.apply(
      threadId,
      item.runId,
      preview.id,
      "operator",
      signal,
    );
    return {
      kind: "napier.workspace-trash-restore",
      schemaVersion: 1,
      trashId,
      restoredPath: item.originalPath,
      evidence: result.evidence,
    };
  }

  private async buildPlan(
    request: WorkspaceFileMutationRequest,
    reservedTrashId?: string,
  ): Promise<WorkspaceFileMutationPlan> {
    if (request.operation === "create_directory") {
      const destinationPath = normalizeMutationPath(request.path);
      const destination = await inspectMissingPath(
        this.workspaceRoot,
        destinationPath,
        request.createParentDirectories === true,
      );
      const plan = {
        request: {
          operation: request.operation,
          path: destinationPath,
          ...(request.createParentDirectories === true
            ? { createParentDirectories: true }
            : {}),
        },
        destinationPath,
        destination,
        lockTargets: [destination.target],
        reversible: false,
      } satisfies Omit<WorkspaceFileMutationPlan, "planSha256">;
      return { ...plan, planSha256: planFingerprint(plan) };
    }
    if (request.operation === "move") {
      const sourcePath = normalizeMutationPath(request.sourcePath);
      const destinationPath = normalizeMutationPath(request.destinationPath);
      if (sourcePath === destinationPath) {
        throw new Error("Workspace file move source and destination are equal");
      }
      const source = await inspectWorkspaceEntry(
        this.workspaceRoot,
        sourcePath,
      );
      const destination = await inspectMissingPath(
        this.workspaceRoot,
        destinationPath,
        false,
      );
      if (
        source.entryKind === "directory" &&
        (destination.target === source.target ||
          destination.target.startsWith(`${source.target}${path.sep}`))
      ) {
        throw new Error(
          "Workspace file move destination cannot be inside the source",
        );
      }
      const plan = {
        request: {
          operation: request.operation,
          sourcePath,
          destinationPath,
        },
        sourcePath,
        destinationPath,
        source,
        destination,
        lockTargets: [source.target, destination.target],
        reversible: true,
      } satisfies Omit<WorkspaceFileMutationPlan, "planSha256">;
      return { ...plan, planSha256: planFingerprint(plan) };
    }
    if (request.operation === "trash") {
      const sourcePath = normalizeMutationPath(request.path);
      const source = await inspectWorkspaceEntry(
        this.workspaceRoot,
        sourcePath,
      );
      const trashId = reservedTrashId ?? createId("trash");
      if (!TRASH_ID.test(trashId)) {
        throw new Error("Workspace trash ID is invalid");
      }
      const itemDirectory = this.trashItemDirectory(trashId);
      const destination = await inspectMissingAbsolutePath(itemDirectory);
      const plan = {
        request: { operation: request.operation, path: sourcePath },
        sourcePath,
        source,
        destination,
        trashId,
        lockTargets: [source.target, itemDirectory],
        reversible: true,
      } satisfies Omit<WorkspaceFileMutationPlan, "planSha256">;
      return { ...plan, planSha256: planFingerprint(plan) };
    }
    if (!TRASH_ID.test(request.trashId)) {
      throw new Error("Workspace trash ID is invalid");
    }
    const trashItem = await this.readTrashItem(request.trashId);
    const sourcePath = path.join(
      this.trashItemDirectory(request.trashId),
      "payload",
    );
    const source = await inspectAbsoluteEntry(sourcePath);
    if (
      source.snapshotSha256 !== trashItem.snapshotSha256 ||
      source.entryKind !== trashItem.entryKind ||
      source.fileCount !== trashItem.fileCount ||
      source.directoryCount !== trashItem.directoryCount ||
      source.bytes !== trashItem.bytes
    ) {
      throw new Error("Workspace trash item bytes drifted; restore is blocked");
    }
    const destinationPath = normalizeMutationPath(trashItem.originalPath);
    const destination = await inspectMissingPath(
      this.workspaceRoot,
      destinationPath,
      false,
    );
    const plan = {
      request: { operation: request.operation, trashId: request.trashId },
      destinationPath,
      source,
      destination,
      trashId: request.trashId,
      trashItem,
      lockTargets: [source.target, destination.target],
      reversible: false,
    } satisfies Omit<WorkspaceFileMutationPlan, "planSha256">;
    return { ...plan, planSha256: planFingerprint(plan) };
  }

  private async commitPlan(
    plan: WorkspaceFileMutationPlan,
    threadId: string,
    runId: string,
  ): Promise<{
    after?: WorkspaceEntrySnapshot;
    createdDirectoryCount?: number;
    trashItem?: WorkspaceTrashItem;
    durable: boolean;
  }> {
    if (plan.request.operation === "create_directory") {
      const created = await createMissingDirectories(
        plan.destination.missingDirectories,
      );
      const after = await inspectWorkspaceEntry(
        this.workspaceRoot,
        plan.destinationPath!,
      ).catch(() => undefined);
      return {
        ...(after ? { after } : {}),
        createdDirectoryCount: created.length,
        durable: true,
      };
    }
    if (plan.request.operation === "move") {
      const durable = await this.atomicRename(
        plan.source!.target,
        plan.destination.target,
      );
      const after = await inspectWorkspaceEntry(
        this.workspaceRoot,
        plan.destinationPath!,
      ).catch(() => undefined);
      return { ...(after ? { after } : {}), durable };
    }
    if (plan.request.operation === "trash") {
      const trashItem = createTrashItem({
        id: plan.trashId!,
        threadId,
        runId,
        originalPath: plan.sourcePath!,
        source: plan.source!,
        trashedAt: this.validNow().toISOString(),
      });
      const itemDirectory = this.trashItemDirectory(plan.trashId!);
      await mkdir(itemDirectory, { mode: 0o700 });
      let manifestWritten = false;
      let moved = false;
      try {
        await writeJsonExclusive(
          path.join(itemDirectory, "manifest.json"),
          trashItem,
        );
        manifestWritten = true;
        const durable = await this.atomicRename(
          plan.source!.target,
          path.join(itemDirectory, "payload"),
        );
        moved = true;
        const after = await inspectAbsoluteEntry(
          path.join(itemDirectory, "payload"),
        ).catch(() => undefined);
        return {
          ...(after ? { after } : {}),
          trashItem,
          durable,
        };
      } catch (error) {
        if (!moved) {
          if (manifestWritten) {
            await unlink(path.join(itemDirectory, "manifest.json")).catch(
              () => undefined,
            );
          }
          await rmdir(itemDirectory).catch(() => undefined);
        }
        throw error;
      }
    }
    const durable = await this.atomicRename(
      plan.source!.target,
      plan.destination.target,
    );
    const after = await inspectWorkspaceEntry(
      this.workspaceRoot,
      plan.destinationPath!,
    ).catch(() => undefined);
    const itemDirectory = this.trashItemDirectory(plan.trashId!);
    await unlink(path.join(itemDirectory, "manifest.json")).catch(
      () => undefined,
    );
    await rmdir(itemDirectory).catch(() => undefined);
    return { ...(after ? { after } : {}), durable };
  }

  private async recordMutation(
    threadId: string,
    runId: string,
    initiatedBy: WorkspaceFileMutationEvidence["initiatedBy"],
    plan: WorkspaceFileMutationPlan,
    applied: {
      after?: WorkspaceEntrySnapshot;
      createdDirectoryCount?: number;
      trashItem?: WorkspaceTrashItem;
      durable: boolean;
    },
  ): Promise<WorkspaceFileMutationEvidence> {
    const source = plan.source;
    const postcondition: WorkspaceFileMutationEvidence["postcondition"] =
      !applied.durable || !applied.after
        ? "indeterminate"
        : !source || source.snapshotSha256 === applied.after.snapshotSha256
          ? "verified"
          : "drifted";
    const observed = applied.after ?? source;
    const fallbackDirectory =
      plan.request.operation === "create_directory" && !observed;
    const content = {
      kind: "napier.workspace-file-mutation" as const,
      schemaVersion: 1 as const,
      id: createId("filemutation"),
      threadId,
      runId,
      operation: plan.request.operation,
      initiatedBy,
      ...(observed
        ? { entryKind: observed.entryKind }
        : fallbackDirectory
          ? { entryKind: "directory" as const }
          : {}),
      ...(plan.sourcePath ? { sourcePathSha256: sha256(plan.sourcePath) } : {}),
      ...(plan.destinationPath
        ? { destinationPathSha256: sha256(plan.destinationPath) }
        : {}),
      ...(source ? { beforeSha256: source.snapshotSha256 } : {}),
      ...(applied.after ? { afterSha256: applied.after.snapshotSha256 } : {}),
      fileCount: observed?.fileCount ?? 0,
      directoryCount: observed?.directoryCount ?? (fallbackDirectory ? 1 : 0),
      bytes: observed?.bytes ?? 0,
      ...(applied.createdDirectoryCount !== undefined
        ? { createdDirectoryCount: applied.createdDirectoryCount }
        : {}),
      ...(plan.trashId ? { trashId: plan.trashId } : {}),
      reversible: plan.reversible,
      postcondition,
      appliedAt: this.validNow().toISOString(),
    };
    const evidence: WorkspaceFileMutationEvidence = {
      ...content,
      contentSha256: sha256(canonicalJson(content)),
    };
    try {
      await this.options.store.appendEvent({
        threadId,
        runId,
        type: "workspace.file.mutated",
        category: "tool",
        visibility: "user",
        payload: evidence as unknown as JsonValue,
      });
    } catch {
      throw new Error(
        "Workspace file mutation applied but Ledger evidence could not be persisted; inspect workspace state before retrying",
      );
    }
    return evidence;
  }

  private async atomicRename(
    source: string,
    destination: string,
  ): Promise<boolean> {
    try {
      await this.renameEntry(source, destination);
    } catch (error) {
      if (errorCode(error) === "EXDEV") {
        throw new Error(
          "Workspace file mutation requires source and destination on one filesystem",
        );
      }
      throw error;
    }
    const sync = await Promise.allSettled([
      syncDirectory(path.dirname(source)),
      path.dirname(destination) === path.dirname(source)
        ? Promise.resolve()
        : syncDirectory(path.dirname(destination)),
    ]);
    return sync.every((result) => result.status === "fulfilled");
  }

  private async readTrashItem(trashId: string): Promise<WorkspaceTrashItem> {
    if (!TRASH_ID.test(trashId)) {
      throw new Error("Workspace trash ID is invalid");
    }
    const itemDirectory = this.trashItemDirectory(trashId);
    const [manifestText, payloadInfo] = await Promise.all([
      readFile(path.join(itemDirectory, "manifest.json"), "utf8"),
      lstat(path.join(itemDirectory, "payload")),
    ]);
    if (payloadInfo.isSymbolicLink()) {
      throw new Error("Workspace trash payload cannot be a symbolic link");
    }
    const parsed = JSON.parse(manifestText) as unknown;
    const item = parseTrashItem(parsed);
    if (!item || item.id !== trashId) {
      throw new Error("Workspace trash manifest is invalid");
    }
    return item;
  }

  private trashItemDirectory(trashId: string): string {
    return path.join(this.trashRoot, trashId);
  }

  private assertReady(): void {
    if (!this.initialized) {
      throw new Error(
        "WorkspaceFileMutationManager.initialize() must be called first",
      );
    }
  }

  private assertRunOwner(threadId: string, runId: string): void {
    this.options.store.getThread(threadId);
    if (
      !this.options.store.listRuns(threadId).some((run) => run.id === runId)
    ) {
      throw new Error(
        "Workspace file mutation Run does not belong to the Thread",
      );
    }
  }

  private prunePreviews(): void {
    const now = this.validNow().getTime();
    for (const [id, stored] of this.previews) {
      if (Date.parse(stored.preview.expiresAt) <= now) {
        this.previews.delete(id);
      }
    }
    const retained = [...this.previews.entries()].sort(
      (left, right) => left[1].createdAtMs - right[1].createdAtMs,
    );
    while (retained.length > MAX_WORKSPACE_FILE_MUTATION_PREVIEWS) {
      const oldest = retained.shift();
      if (oldest) this.previews.delete(oldest[0]);
    }
  }

  private validNow(): Date {
    const value = this.currentTime();
    if (!Number.isFinite(value.getTime())) {
      throw new Error("Workspace file mutation time is invalid");
    }
    return value;
  }
}

function planFingerprint(
  plan: Omit<WorkspaceFileMutationPlan, "planSha256">,
): string {
  return sha256(
    canonicalJson({
      operation: plan.request.operation,
      sourcePathSha256: plan.sourcePath ? sha256(plan.sourcePath) : null,
      destinationPathSha256: plan.destinationPath
        ? sha256(plan.destinationPath)
        : null,
      source: plan.source ? scopeFromSnapshot(plan.source) : null,
      destinationMissingDirectorySetSha256: sha256(
        canonicalJson(
          plan.destination.missingDirectories.map((directory) =>
            sha256(directory),
          ),
        ),
      ),
      destinationParentStateSha256: plan.destination.parentStateSha256,
      trashId: plan.trashId ?? null,
      trashManifestSha256: plan.trashItem?.contentSha256 ?? null,
      reversible: plan.reversible,
    }),
  );
}

function assertNotAborted(
  signal: AbortSignal | undefined,
  message: string,
): void {
  if (signal?.aborted) throw new Error(message);
}
