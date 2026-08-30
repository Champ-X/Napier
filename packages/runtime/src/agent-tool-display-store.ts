import { chmod, lstat, mkdir, open, readdir, readFile, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  formatAgentToolDisplayInput,
  formatAgentToolDisplayOutput,
} from "./agent-tool-display.js";

const THREAD_ID = /^thread_[a-z0-9]{8,80}$/u;
const RUN_ID = /^run_[a-z0-9_-]{8,80}$/u;
const CALL_ID = /^[A-Za-z0-9_.:-]{1,160}$/u;
const TOOL_NAME = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u;
const HASH_FILE = /^[a-f0-9]{64}\.json$/u;
const MAX_RECORD_BYTES = 4 * 1024 * 1024;
const MAX_RECORDS = 4_096;
const MAX_STORAGE_BYTES = 256 * 1024 * 1024;

export interface AgentToolDisplayRecord {
  kind: "napier.local-tool-display";
  schemaVersion: 1;
  sourceThreadId: string;
  sourceRunId: string;
  callId: string;
  toolName: string;
  input?: string;
  output?: string;
  error?: string;
  contentSha256: string;
}

interface ToolDisplayOwner {
  threadId: string;
  runId: string;
  callId: string;
  toolName: string;
}

export function agentToolDisplayOwner(
  run: { threadId: string; id: string },
  event: { toolCallId: string; toolName: string },
): ToolDisplayOwner {
  return {
    threadId: run.threadId,
    runId: run.id,
    callId: event.toolCallId,
    toolName: event.toolName,
  };
}

export class AgentToolDisplayStore {
  readonly rootPath: string;
  private writeTail: Promise<void> = Promise.resolve();

  constructor(dataRoot: string) {
    this.rootPath = path.join(path.resolve(dataRoot), "tool-displays");
  }

  recordInput(owner: ToolDisplayOwner, value: unknown): Promise<void> {
    return this.update(owner, {
      input: formatAgentToolDisplayInput(owner.toolName, value),
    });
  }

  recordOutput(
    owner: ToolDisplayOwner,
    value: string,
    failed: boolean,
  ): Promise<void> {
    const text = formatAgentToolDisplayOutput(value);
    return this.update(owner, failed ? { error: text } : { output: text });
  }

  async listThread(threadId: string): Promise<AgentToolDisplayRecord[]> {
    if (!THREAD_ID.test(threadId)) throw new Error("Tool display thread ID is invalid");
    let names: string[];
    try {
      names = (await readdir(this.rootPath)).filter((name) => HASH_FILE.test(name));
    } catch (error) {
      if (errorCode(error) === "ENOENT") return [];
      throw error;
    }
    const records: AgentToolDisplayRecord[] = [];
    for (const name of names) {
      const filePath = path.join(this.rootPath, name);
      const info = await lstat(filePath);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        (info.mode & 0o077) !== 0 ||
        info.size < 1 ||
        info.size > MAX_RECORD_BYTES
      ) {
        throw new Error("Tool display file is invalid");
      }
      const record = validateRecord(JSON.parse(await readFile(filePath, "utf8")));
      if (`${identitySha256(record)}.json` !== name) {
        throw new Error("Tool display path binding is invalid");
      }
      if (record.sourceThreadId === threadId) records.push(record);
    }
    return records.sort((left, right) =>
      `${left.sourceRunId}\0${left.callId}`.localeCompare(
        `${right.sourceRunId}\0${right.callId}`,
      ),
    );
  }

  private async update(
    owner: ToolDisplayOwner,
    patch: Pick<AgentToolDisplayRecord, "input" | "output" | "error">,
  ): Promise<void> {
    validateOwner(owner);
    const previous = this.writeTail;
    let release = (): void => undefined;
    this.writeTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      await this.updateExclusive(owner, patch);
    } finally {
      release();
    }
  }

  private async updateExclusive(
    owner: ToolDisplayOwner,
    patch: Pick<AgentToolDisplayRecord, "input" | "output" | "error">,
  ): Promise<void> {
    await this.ensureRoot();
    const target = path.join(this.rootPath, `${identitySha256(owner)}.json`);
    const existing = await this.readExisting(target, owner);
    const content = {
      kind: "napier.local-tool-display" as const,
      schemaVersion: 1 as const,
      sourceThreadId: owner.threadId,
      sourceRunId: owner.runId,
      callId: owner.callId,
      toolName: owner.toolName,
      ...(existing?.input ? { input: existing.input } : {}),
      ...(existing?.output ? { output: existing.output } : {}),
      ...(existing?.error ? { error: existing.error } : {}),
      ...definedDisplayPatch(patch),
    };
    const record = validateRecord({
      ...content,
      contentSha256: sha256(canonicalJson(content)),
    });
    const serialized = canonicalJson(record);
    const bytes = Buffer.byteLength(serialized, "utf8");
    if (bytes > MAX_RECORD_BYTES) throw new Error("Tool display exceeds its byte limit");
    await this.assertCapacity(target, bytes, existing !== undefined);
    const temporary = path.join(
      this.rootPath,
      `.${identitySha256(owner)}.${process.pid}.${Date.now()}.tmp`,
    );
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporary, "wx", 0o600);
      await handle.writeFile(serialized, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, target);
      await chmod(target, 0o600);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  private async readExisting(
    filePath: string,
    owner: ToolDisplayOwner,
  ): Promise<AgentToolDisplayRecord | undefined> {
    try {
      const info = await lstat(filePath);
      if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) {
        throw new Error("Tool display file is invalid");
      }
      const record = validateRecord(JSON.parse(await readFile(filePath, "utf8")));
      if (identitySha256(record) !== identitySha256(owner)) {
        throw new Error("Tool display owner binding is invalid");
      }
      return record;
    } catch (error) {
      if (errorCode(error) === "ENOENT") return undefined;
      throw error;
    }
  }

  private async ensureRoot(): Promise<void> {
    await mkdir(this.rootPath, { recursive: true, mode: 0o700 });
    const info = await lstat(this.rootPath);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error("Tool display directory is invalid");
    }
    await chmod(this.rootPath, 0o700);
  }

  private async assertCapacity(
    target: string,
    nextBytes: number,
    replacing: boolean,
  ): Promise<void> {
    const names = (await readdir(this.rootPath)).filter((name) => HASH_FILE.test(name));
    if (!replacing && names.length >= MAX_RECORDS) {
      throw new Error("Tool display count limit reached");
    }
    let bytes = 0;
    for (const name of names) {
      const candidate = path.join(this.rootPath, name);
      if (candidate !== target) bytes += (await stat(candidate)).size;
    }
    if (bytes + nextBytes > MAX_STORAGE_BYTES) {
      throw new Error("Tool display storage byte limit reached");
    }
  }
}

function validateRecord(value: unknown): AgentToolDisplayRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Tool display record is invalid");
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set([
    "kind", "schemaVersion", "sourceThreadId", "sourceRunId",
    "callId", "toolName", "input", "output", "error", "contentSha256",
  ]);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new Error("Tool display record fields are invalid");
  }
  const owner = {
    threadId: record["sourceThreadId"],
    runId: record["sourceRunId"],
    callId: record["callId"],
    toolName: record["toolName"],
  };
  validateOwner(owner);
  for (const key of ["input", "output", "error"] as const) {
    const text = record[key];
    if (text !== undefined && (typeof text !== "string" || !text.length)) {
      throw new Error("Tool display content is invalid");
    }
  }
  if (record["kind"] !== "napier.local-tool-display" ||
      record["schemaVersion"] !== 1 ||
      typeof record["contentSha256"] !== "string" ||
      !/^[a-f0-9]{64}$/u.test(record["contentSha256"])) {
    throw new Error("Tool display record is invalid");
  }
  const { contentSha256, ...content } = record;
  if (sha256(canonicalJson(content)) !== contentSha256) {
    throw new Error("Tool display content binding is invalid");
  }
  return record as unknown as AgentToolDisplayRecord;
}

function validateOwner(owner: {
  threadId: unknown; runId: unknown; callId: unknown; toolName: unknown;
}): asserts owner is ToolDisplayOwner {
  if (typeof owner.threadId !== "string" || !THREAD_ID.test(owner.threadId) ||
      typeof owner.runId !== "string" || !RUN_ID.test(owner.runId) ||
      typeof owner.callId !== "string" || !CALL_ID.test(owner.callId) ||
      typeof owner.toolName !== "string" || !TOOL_NAME.test(owner.toolName)) {
    throw new Error("Tool display owner is invalid");
  }
}

function identitySha256(owner: ToolDisplayOwner | AgentToolDisplayRecord): string {
  return sha256(canonicalJson({
    sourceThreadId: "sourceThreadId" in owner ? owner.sourceThreadId : owner.threadId,
    sourceRunId: "sourceRunId" in owner ? owner.sourceRunId : owner.runId,
    callId: owner.callId,
    toolName: owner.toolName,
  }));
}

function definedDisplayPatch(
  patch: Pick<AgentToolDisplayRecord, "input" | "output" | "error">,
): Partial<AgentToolDisplayRecord> {
  return Object.fromEntries(
    Object.entries(patch).filter((entry): entry is [string, string] =>
      typeof entry[1] === "string" && entry[1].length > 0),
  );
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}
