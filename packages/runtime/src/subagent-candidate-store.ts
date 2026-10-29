import { constants } from "node:fs";
import { lstat, open, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { canonicalJson, sha256 } from "./ed25519.js";
import { createId } from "./ids.js";
import { LocalPrivateCapsuleStore } from "./local-private-capsule-store.js";
import { resolvePreparedSubagentCompletion } from "./subagent-completion-capability.js";
import type { PreparedSubagentCompletion, SubagentCandidateDeliveryAuthority } from "./subagent-completion-types.js";
import { subagentWorktreeModifiedLspFiles } from "./subagent-worktree-diff.js";
import type {
  SubagentWorktreeApplyResult,
  WorktreePreviewSource,
} from "./subagent-worktree-mutation-model.js";
import { errorCode } from "./subagent-worktree-snapshot.js";
import { withWorkspacePathLock } from "./workspace-write-lock.js";

export const SUBAGENT_CANDIDATE_RETENTION_MS = 30 * 24 * 60 * 60_000;
export const SUBAGENT_CANDIDATE_APPLY_TTL_MS = 7 * 24 * 60 * 60_000;
const ID = /^subworkpreview_([a-f0-9]{64})$/u;
const MAX_OBJECT_BYTES = 80 * 1024 * 1024;

interface CandidateEnvelope {
  schemaVersion: 1 | 2;
  nonce?: string;
  workspaceRoot: string;
  dataRoot: string;
  createdAt: string;
  expiresAt: string;
  source: WorktreePreviewSource;
}

export interface CandidateState {
  candidateId: string;
  status: "applying" | "settled" | "revoked";
  updatedAt: string;
  result?: SubagentWorktreeApplyResult;
  merge?: Array<{
    path: string;
    beforeSha256: string | null;
    afterSha256: string | null;
  }>;
}

// Independent from process-owned disposable workspaces. Content is addressed by
// hash, and each apply has an interprocess lock and a durable pre-commit marker.
export class SubagentCandidateStore {
  private readonly capsules: LocalPrivateCapsuleStore<CandidateEnvelope>;
  constructor(
    private readonly options: {
      workspaceRoot: string;
      dataRoot: string;
      now?: () => Date;
      candidateDeliveryAuthority?: SubagentCandidateDeliveryAuthority;
      requireCompletionBinding?: boolean;
    },
  ) {
    this.capsules = new LocalPrivateCapsuleStore({
      dataRoot: options.dataRoot,
      directory: "subagent-candidates",
      label: "Subagent candidate",
      maxObjectBytes: MAX_OBJECT_BYTES,
      maxObjects: 128,
      maxStorageBytes: 1024 * 1024 * 1024,
      parse: parseEnvelope,
      contentSha256: (value) => sha256(canonicalJson(value)),
    });
  }

  async store(
    source: WorktreePreviewSource,
    prepared?: PreparedSubagentCompletion,
  ): Promise<{ id: string; expiresAt: string; cleanupOwned: boolean }> {
    const preparation = prepared ? resolvePreparedSubagentCompletion(prepared) : undefined;
    if (source.completion && !preparation) throw new Error("Subagent candidate requires completion preparation authority");
    if (preparation && (preparation.reservation.producerTaskId !== source.taskId || source.completion))
      throw new Error("Subagent candidate completion producer binding changed");
    const now = preparation ? new Date(preparation.reservation.createdAt) : this.now();
    const envelope: CandidateEnvelope = {
      schemaVersion: preparation ? 2 : 1,
      ...(!preparation ? { nonce: createId("candidate") } : {}),
      workspaceRoot: await realpath(this.options.workspaceRoot),
      dataRoot: await realpath(this.options.dataRoot),
      createdAt: now.toISOString(),
      expiresAt: new Date(
        now.getTime() + SUBAGENT_CANDIDATE_APPLY_TTL_MS,
      ).toISOString(),
      // LSP full-text edits are derived on load, avoiding a second text copy.
      source: { ...source, files: [], ...(preparation ? { completion: preparation.reservation } : {}) },
    };
    const serialized = canonicalJson(envelope);
    const hash = sha256(serialized);
    const id = `subworkpreview_${hash}`;
    if (preparation) await preparation.claimCandidate({ id, sourceSha256: candidateSourceSha256(envelope.source) });
    let cleanupOwned = true;
    try {
      await withStorageLock(
        this.options.dataRoot,
        path.join(envelope.dataRoot, "subagent-candidates"),
        async () => {
          try { await this.capsules.read(hash); cleanupOwned = false; }
          catch (error) { if (errorCode(error) !== "ENOENT") throw error; }
          await this.capsules.put(hash, serialized);
          await syncDirectory(this.capsules.rootPath);
        },
      );
    } catch (error) {
      if (!cleanupOwned) throw error;
      // A write may install the capsule before a later I/O failure rejects.
      // The delivery caller cannot retract it because no ID was returned yet.
      try {
        await lstat(path.join(this.capsules.rootPath, `${hash}.json`));
      } catch (inspectionError) {
        if (errorCode(inspectionError) === "ENOENT") throw error;
        throw unresolvedCandidateCleanup(error, inspectionError);
      }
      return rethrowAfterCandidateRevocation(error, () =>
        this.revokeUndelivered(id, source.taskId),
      );
    }
    return { id, expiresAt: envelope.expiresAt, cleanupOwned };
  }

  async apply(
    id: string,
    operation: (
      source: WorktreePreviewSource,
    ) => Promise<SubagentWorktreeApplyResult>,
  ): Promise<SubagentWorktreeApplyResult> {
    const hash = candidateHash(id);
    return withWorkspacePathLock(
      this.options.dataRoot,
      await this.lockTarget(hash),
      async () => {
        const envelope = await this.read(id);
        if (this.options.requireCompletionBinding && !envelope.source.completion)
          throw new Error("Subagent candidate has no durable completion binding; retained for inspection");
        const state = await this.readState(id);
        if (state?.status === "revoked")
          throw new Error(
            "Subagent candidate was revoked before delivery; retained candidate is inspection-only",
          );
        if (state?.status === "applying")
          throw new Error(
            `Subagent candidate ${id} requires reconciliation after an interrupted merge; retained candidate must not be replayed`,
          );
        if (envelope.source.completion && !(await this.isDelivered(id, envelope.source)))
          throw new Error("Subagent candidate has no committed completion authority");
        if (
          state?.result &&
          !(
            state.result.details.status === "rolled_back" &&
            state.result.details.rollbackVerified &&
            state.result.details.durable
          )
        ) {
          return {
            ...state.result,
            summary: `${state.result.summary}\n\nStored merge receipt reused; this retry performed no writes and did not reverify the current workspace.`,
          };
        }
        if (Date.parse(envelope.expiresAt) <= this.now().getTime())
          throw new Error(
            "Subagent worktree apply preview expired; candidate remains retained for inspection",
          );
        const source = envelope.source;
        source.files = subagentWorktreeModifiedLspFiles(source.changes);
        source.candidateId = id;
        const result = await operation(source);
        await this.writeState({
          candidateId: id,
          status: "settled",
          updatedAt: this.now().toISOString(),
          result,
        });
        return result;
      },
      "Subagent candidate apply",
    );
  }

  async beginCommit(source: WorktreePreviewSource): Promise<void> {
    if (!source.candidateId)
      throw new Error("Subagent merge has no retained candidate");
    await this.writeState({
      candidateId: source.candidateId,
      status: "applying",
      updatedAt: this.now().toISOString(),
      merge: source.changes.map(({ path, beforeSha256, afterSha256 }) => ({
        path,
        beforeSha256,
        afterSha256,
      })),
    });
  }

  // The caller owns this newly stored, undelivered candidate. Serialize with
  // apply so interruption cleanup can never overwrite a merge receipt.
  async revokeUndelivered(id: string, taskId: string): Promise<boolean> {
    return withWorkspacePathLock(
      this.options.dataRoot,
      await this.lockTarget(candidateHash(id)),
      async () => {
        const envelope = await this.read(id);
        if (envelope.source.taskId !== taskId)
          throw new Error("Subagent candidate task binding changed");
        const state = await this.readState(id);
        if (state?.status === "revoked") return true;
        if (state) return false;
        if (envelope.source.completion && await this.isDelivered(id, envelope.source)) return false;
        await this.writeState({
          candidateId: id,
          status: "revoked",
          updatedAt: this.now().toISOString(),
        });
        return true;
      },
      "Subagent candidate revocation",
    );
  }

  async inspect(id: string): Promise<{
    expiresAt: string;
    source: WorktreePreviewSource;
    state: CandidateState | undefined;
  }> {
    const envelope = await this.read(id);
    return {
      expiresAt: envelope.expiresAt,
      source: envelope.source,
      state: await this.readState(id),
    };
  }

  /** Serialize completion with revocation and application without changing merge state. */
  async withCompletionLock<T>(id: string, operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await withWorkspacePathLock(this.options.dataRoot, await this.lockTarget(candidateHash(id)),
          operation, "Subagent candidate completion");
      } catch (error) {
        if (attempt >= 200 || !(error instanceof Error) ||
            error.message !== "Subagent candidate completion target is already being edited") throw error;
        await delay(25);
      }
    }
  }

  private async isDelivered(id: string, source: WorktreePreviewSource): Promise<boolean> {
    if (!source.completion || !this.options.candidateDeliveryAuthority) return false;
    return this.options.candidateDeliveryAuthority(source.completion,
      { id, sourceSha256: candidateSourceSha256(source) });
  }

  // Explicit retention cleanup, never touches an uncertain in-progress merge.
  async prune(ids: string[]): Promise<number> {
    let removed = 0;
    for (const id of ids) {
      const hash = candidateHash(id);
      await withWorkspacePathLock(
        this.options.dataRoot,
        await this.lockTarget(hash),
        async () => {
          const envelope = await this.read(id);
          const state = await this.readState(id);
          if (
            this.now().getTime() - Date.parse(envelope.createdAt) <
              SUBAGENT_CANDIDATE_RETENTION_MS ||
            state?.status === "applying" ||
            (state?.result &&
              (!state.result.details.durable ||
                state.result.details.postcondition !== "verified"))
          )
            return;
          await rm(path.join(this.capsules.rootPath, `${hash}.json`));
          await rm(path.join(this.capsules.rootPath, `${hash}.state`), {
            force: true,
          });
          await syncDirectory(this.capsules.rootPath);
          removed += 1;
        },
        "Subagent candidate cleanup",
      );
    }
    return removed;
  }

  private async read(id: string): Promise<CandidateEnvelope> {
    await this.assertRoot();
    let value: CandidateEnvelope;
    try {
      value = await this.capsules.read(candidateHash(id));
    } catch (error) {
      if (errorCode(error) === "ENOENT")
        throw new Error("Subagent worktree apply preview not found");
      throw error;
    }
    if (
      value.workspaceRoot !== (await realpath(this.options.workspaceRoot)) ||
      value.dataRoot !== (await realpath(this.options.dataRoot)) ||
      value.source.sourceRoot !== value.workspaceRoot
    ) {
      throw new Error("Subagent candidate workspace binding changed");
    }
    return value;
  }

  private async lockTarget(hash: string): Promise<string> {
    return path.join(
      await realpath(this.options.dataRoot),
      "subagent-candidates",
      `${hash}.state`,
    );
  }

  private async assertRoot(): Promise<void> {
    const info = await lstat(this.capsules.rootPath);
    const expected = path.join(
      await realpath(this.options.dataRoot),
      "subagent-candidates",
    );
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (info.mode & 0o077) !== 0 ||
      (await realpath(this.capsules.rootPath)) !== expected
    )
      throw new Error("Subagent candidate directory is unsafe");
  }

  private async readState(id: string): Promise<CandidateState | undefined> {
    const target = path.join(
      this.capsules.rootPath,
      `${candidateHash(id)}.state`,
    );
    let handle;
    try {
      handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      if (errorCode(error) === "ENOENT") return undefined;
      throw error;
    }
    try {
      const info = await handle.stat();
      if (
        !info.isFile() ||
        info.size > MAX_OBJECT_BYTES ||
        (info.mode & 0o077) !== 0
      )
        throw new Error("Subagent candidate state is unsafe");
      const record = JSON.parse(await handle.readFile("utf8")) as {
        state: CandidateState;
        sha256: string;
      };
      if (
        sha256(canonicalJson(record.state)) !== record.sha256 ||
        record.state.candidateId !== id ||
        !["applying", "settled", "revoked"].includes(record.state.status)
      )
        throw new Error("Subagent candidate state binding changed");
      if (record.state.status === "settled" && !record.state.result)
        throw new Error("Subagent candidate settlement is missing");
      return record.state;
    } finally {
      await handle.close();
    }
  }

  private async writeState(state: CandidateState): Promise<void> {
    await this.assertRoot();
    const target = path.join(
      this.capsules.rootPath,
      `${candidateHash(state.candidateId)}.state`,
    );
    const temporary = `${target}.${createId("write")}.tmp`;
    try {
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(
          canonicalJson({ state, sha256: sha256(canonicalJson(state)) }),
        );
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, target);
      await syncDirectory(this.capsules.rootPath);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  private now(): Date {
    const value = this.options.now?.() ?? new Date();
    if (!Number.isFinite(value.getTime()))
      throw new Error("Subagent candidate time is invalid");
    return value;
  }
}

/** Cleanup failures preserve the original interruption and retain all evidence. */
export async function rethrowAfterCandidateRevocation(
  error: unknown,
  revoke: () => Promise<boolean>,
): Promise<never> {
  try {
    if (!(await revoke()))
      throw new Error("Subagent candidate is applying or settled; retained without revocation");
  } catch (cleanupError) {
    throw unresolvedCandidateCleanup(error, cleanupError);
  }
  throw error;
}

export function unresolvedCandidateCleanup(error: unknown, cleanupError: unknown): AggregateError {
  const message = error instanceof Error ? error.message : String(error);
  return new AggregateError(
    [error, cleanupError],
    `${message}; retained candidate cleanup unresolved`,
    { cause: error },
  );
}

function parseEnvelope(text: string): CandidateEnvelope {
  const value = JSON.parse(text) as CandidateEnvelope;
  if (
    ![1, 2].includes(value.schemaVersion) ||
    !value.source ||
    !Array.isArray(value.source.changes) ||
    !Array.isArray(value.source.readDependencies) ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    !Number.isFinite(Date.parse(value.expiresAt))
  )
    throw new Error("Subagent candidate record is invalid");
  return value;
}

export function candidateSourceSha256(source: WorktreePreviewSource): string {
  return sha256(canonicalJson({ ...source, files: [] }));
}

function candidateHash(id: string): string {
  const match = ID.exec(id);
  if (!match) throw new Error("Subagent worktree apply preview ID is invalid");
  return match[1]!;
}

async function syncDirectory(root: string): Promise<void> {
  const handle = await open(root, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function withStorageLock<T>(
  dataRoot: string,
  root: string,
  operation: () => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await withWorkspacePathLock(
        dataRoot,
        root,
        operation,
        "Subagent candidate storage",
      );
    } catch (error) {
      if (
        attempt >= 200 ||
        !(error instanceof Error) ||
        error.message !==
          "Subagent candidate storage target is already being edited"
      )
        throw error;
      await delay(25);
    }
  }
}
