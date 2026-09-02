import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";

import type { RunEvent } from "@napier/contracts";

import { sanitizeDisplayText } from "./agent-tool-display.js";
import type { ConversationSurfaceCapsuleStore } from "./conversation-surface-capsule-store.js";
import { validateConversationSurfaceCapsuleReceipt } from "./conversation-surface-capsule.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import type { LocalStore } from "./store.js";

const THREAD_ID = /^thread_[a-z0-9]{8,80}$/u;
const RUN_ID = /^run_[a-z0-9_-]{8,80}$/u;
const EVENT_ID = /^event_[a-z0-9]{8,80}$/u;
const HASH_FILE = /^[a-f0-9]{64}\.json$/u;
const MAX_RECORD_BYTES = 8 * 1024 * 1024;
const MAX_RECORDS = 4_096;
const MAX_STORAGE_BYTES = 256 * 1024 * 1024;

export type AgentModelDisplayOrigin =
  | "captured_response"
  | "conversation_surface";

/**
 * Local-only model output used by the operator UI. It is deliberately kept
 * outside the portable Ledger so private source material is never exported by
 * replay or evidence APIs.
 */
export interface AgentModelDisplayRecord {
  kind: "napier.local-model-display";
  schemaVersion: 1;
  sourceThreadId: string;
  sourceRunId: string;
  responseEventId: string;
  modelContextEnvelopeTurnIndex?: number;
  text?: string;
  thinking?: string;
  origin: AgentModelDisplayOrigin;
  contentSha256: string;
}

interface ModelDisplayOwner {
  threadId: string;
  runId: string;
  responseEventId: string;
  modelContextEnvelopeTurnIndex?: number;
}

interface LegacyModelDisplaySource {
  store: Pick<LocalStore, "listEvents">;
  capsules: Pick<ConversationSurfaceCapsuleStore, "read">;
}

export class AgentModelDisplayStore {
  readonly rootPath: string;
  private writeTail: Promise<void> = Promise.resolve();

  constructor(
    dataRoot: string,
    private readonly legacySource?: LegacyModelDisplaySource,
  ) {
    this.rootPath = path.join(path.resolve(dataRoot), "model-displays");
  }

  async recordResponse(
    owner: ModelDisplayOwner,
    content: { text: string; thinking: string },
  ): Promise<void> {
    validateOwner(owner);
    const text = displayText(content.text);
    const thinking = displayText(content.thinking);
    if (!text && !thinking) return;
    const record = createRecord(owner, {
      ...(text ? { text } : {}),
      ...(thinking ? { thinking } : {}),
      origin: "captured_response",
    });
    const previous = this.writeTail;
    let release = (): void => undefined;
    this.writeTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      await this.writeExclusive(record);
    } finally {
      release();
    }
  }

  async listThread(threadId: string): Promise<AgentModelDisplayRecord[]> {
    if (!THREAD_ID.test(threadId)) {
      throw new Error("Model display thread ID is invalid");
    }
    const captured = await this.listCaptured(threadId);
    if (!this.legacySource) return captured;
    const events = await this.legacySource.store.listEvents(threadId);
    const byResponseEventId = new Map<string, AgentModelDisplayRecord>();
    for (const record of await this.legacyDisplays(threadId, events)) {
      byResponseEventId.set(record.responseEventId, record);
    }
    for (const record of captured) {
      byResponseEventId.set(record.responseEventId, record);
    }
    const seqByEventId = new Map(events.map((event) => [event.id, event.seq]));
    return [...byResponseEventId.values()].sort(
      (left, right) =>
        (seqByEventId.get(left.responseEventId) ?? Number.MAX_SAFE_INTEGER) -
          (seqByEventId.get(right.responseEventId) ??
            Number.MAX_SAFE_INTEGER) ||
        left.responseEventId.localeCompare(right.responseEventId),
    );
  }

  private async legacyDisplays(
    threadId: string,
    events: readonly RunEvent[],
  ): Promise<AgentModelDisplayRecord[]> {
    if (!this.legacySource) return [];
    const responseByBinding = new Map<string, RunEvent>();
    for (const event of events) {
      if (event.type !== "model.response") continue;
      const payload = recordValue(event.payload);
      const envelopeSha256 = stringValue(
        payload?.["modelContextEnvelopeSha256"],
      );
      const turnIndex = nonNegativeInteger(
        payload?.["modelContextEnvelopeTurnIndex"],
      );
      if (!envelopeSha256 || turnIndex === undefined) continue;
      responseByBinding.set(
        responseBinding(event.runId, envelopeSha256, turnIndex),
        event,
      );
    }

    const displays: AgentModelDisplayRecord[] = [];
    for (const event of events) {
      if (event.type !== "context.conversation_surface") continue;
      try {
        const receipt = validateConversationSurfaceCapsuleReceipt(
          event.payload,
        );
        const response = responseByBinding.get(
          responseBinding(
            event.runId,
            receipt.modelContextEnvelopeSha256,
            receipt.modelContextEnvelopeTurnIndex,
          ),
        );
        if (!response) continue;
        const capsule = await this.legacySource.capsules.read(
          receipt.capsuleSha256,
        );
        if (
          capsule.sourceThreadId !== threadId ||
          capsule.sourceRunId !== event.runId
        ) {
          continue;
        }
        const text = displayText(
          capsule.exchange.assistantContent
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join(""),
        );
        const thinking = displayText(
          capsule.exchange.assistantContent
            .filter((block) => block.type === "thinking")
            .map((block) => block.thinking)
            .join(""),
        );
        if (!text && !thinking) continue;
        displays.push(
          createRecord(
            {
              threadId,
              runId: event.runId,
              responseEventId: response.id,
              modelContextEnvelopeTurnIndex:
                receipt.modelContextEnvelopeTurnIndex,
            },
            {
              ...(text ? { text } : {}),
              ...(thinking ? { thinking } : {}),
              origin: "conversation_surface",
            },
          ),
        );
      } catch {
        // A missing or invalid local capsule must not make the thread unreadable.
      }
    }
    return displays;
  }

  private async listCaptured(
    threadId: string,
  ): Promise<AgentModelDisplayRecord[]> {
    let names: string[];
    try {
      names = (await readdir(this.rootPath)).filter((name) =>
        HASH_FILE.test(name),
      );
    } catch (error) {
      if (errorCode(error) === "ENOENT") return [];
      throw error;
    }
    const records: AgentModelDisplayRecord[] = [];
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
        throw new Error("Model display file is invalid");
      }
      const record = validateRecord(
        JSON.parse(await readFile(filePath, "utf8")),
      );
      if (`${identitySha256(record)}.json` !== name) {
        throw new Error("Model display path binding is invalid");
      }
      if (record.sourceThreadId === threadId) records.push(record);
    }
    return records;
  }

  private async writeExclusive(record: AgentModelDisplayRecord): Promise<void> {
    await this.ensureRoot();
    const target = path.join(this.rootPath, `${identitySha256(record)}.json`);
    try {
      const existing = validateRecord(
        JSON.parse(await readFile(target, "utf8")),
      );
      if (existing.contentSha256 === record.contentSha256) return;
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
    const serialized = canonicalJson(record);
    const bytes = Buffer.byteLength(serialized, "utf8");
    if (bytes > MAX_RECORD_BYTES) {
      throw new Error("Model display exceeds its byte limit");
    }
    await this.assertCapacity(target, bytes);
    const temporary = path.join(
      this.rootPath,
      `.${identitySha256(record)}.${process.pid}.${Date.now()}.tmp`,
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

  private async ensureRoot(): Promise<void> {
    await mkdir(this.rootPath, { recursive: true, mode: 0o700 });
    const info = await lstat(this.rootPath);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error("Model display directory is invalid");
    }
    await chmod(this.rootPath, 0o700);
  }

  private async assertCapacity(
    target: string,
    nextBytes: number,
  ): Promise<void> {
    const names = (await readdir(this.rootPath)).filter((name) =>
      HASH_FILE.test(name),
    );
    const replacing = await fileExists(target);
    if (!replacing && names.length >= MAX_RECORDS) {
      throw new Error("Model display count limit reached");
    }
    let bytes = 0;
    for (const name of names) {
      const candidate = path.join(this.rootPath, name);
      if (candidate !== target) bytes += (await stat(candidate)).size;
    }
    if (bytes + nextBytes > MAX_STORAGE_BYTES) {
      throw new Error("Model display storage byte limit reached");
    }
  }
}

function createRecord(
  owner: ModelDisplayOwner,
  content: {
    text?: string;
    thinking?: string;
    origin: AgentModelDisplayOrigin;
  },
): AgentModelDisplayRecord {
  validateOwner(owner);
  const body = {
    kind: "napier.local-model-display" as const,
    schemaVersion: 1 as const,
    sourceThreadId: owner.threadId,
    sourceRunId: owner.runId,
    responseEventId: owner.responseEventId,
    ...(owner.modelContextEnvelopeTurnIndex !== undefined
      ? {
          modelContextEnvelopeTurnIndex: owner.modelContextEnvelopeTurnIndex,
        }
      : {}),
    ...(content.text ? { text: content.text } : {}),
    ...(content.thinking ? { thinking: content.thinking } : {}),
    origin: content.origin,
  };
  return validateRecord({
    ...body,
    contentSha256: sha256(canonicalJson(body)),
  });
}

function validateRecord(value: unknown): AgentModelDisplayRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Model display record is invalid");
  }
  const candidate = value as Record<string, unknown>;
  const allowed = new Set([
    "kind",
    "schemaVersion",
    "sourceThreadId",
    "sourceRunId",
    "responseEventId",
    "modelContextEnvelopeTurnIndex",
    "text",
    "thinking",
    "origin",
    "contentSha256",
  ]);
  if (Object.keys(candidate).some((key) => !allowed.has(key))) {
    throw new Error("Model display record fields are invalid");
  }
  validateOwner({
    threadId: candidate["sourceThreadId"],
    runId: candidate["sourceRunId"],
    responseEventId: candidate["responseEventId"],
    modelContextEnvelopeTurnIndex: candidate["modelContextEnvelopeTurnIndex"],
  });
  const text = candidate["text"];
  const thinking = candidate["thinking"];
  if (
    (text !== undefined && (typeof text !== "string" || !text.length)) ||
    (thinking !== undefined &&
      (typeof thinking !== "string" || !thinking.length)) ||
    (!text && !thinking) ||
    (candidate["origin"] !== "captured_response" &&
      candidate["origin"] !== "conversation_surface") ||
    candidate["kind"] !== "napier.local-model-display" ||
    candidate["schemaVersion"] !== 1 ||
    typeof candidate["contentSha256"] !== "string" ||
    !/^[a-f0-9]{64}$/u.test(candidate["contentSha256"])
  ) {
    throw new Error("Model display record is invalid");
  }
  const { contentSha256, ...body } = candidate;
  if (sha256(canonicalJson(body)) !== contentSha256) {
    throw new Error("Model display content binding is invalid");
  }
  return candidate as unknown as AgentModelDisplayRecord;
}

function validateOwner(owner: {
  threadId: unknown;
  runId: unknown;
  responseEventId: unknown;
  modelContextEnvelopeTurnIndex?: unknown;
}): asserts owner is ModelDisplayOwner {
  if (
    typeof owner.threadId !== "string" ||
    !THREAD_ID.test(owner.threadId) ||
    typeof owner.runId !== "string" ||
    !RUN_ID.test(owner.runId) ||
    typeof owner.responseEventId !== "string" ||
    !EVENT_ID.test(owner.responseEventId) ||
    (owner.modelContextEnvelopeTurnIndex !== undefined &&
      nonNegativeInteger(owner.modelContextEnvelopeTurnIndex) === undefined)
  ) {
    throw new Error("Model display owner is invalid");
  }
}

function displayText(value: string): string | undefined {
  const sanitized = sanitizeDisplayText(value);
  return sanitized.length > 0 ? sanitized : undefined;
}

function identitySha256(
  record: Pick<
    AgentModelDisplayRecord,
    "sourceThreadId" | "sourceRunId" | "responseEventId"
  >,
): string {
  return sha256(
    canonicalJson({
      sourceThreadId: record.sourceThreadId,
      sourceRunId: record.sourceRunId,
      responseEventId: record.responseEventId,
    }),
  );
}

function responseBinding(
  runId: string,
  envelopeSha256: string,
  turnIndex: number,
): string {
  return `${runId}\0${envelopeSha256}\0${String(turnIndex)}`;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}
