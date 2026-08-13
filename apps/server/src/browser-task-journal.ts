import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { JsonValue } from "@napier/contracts";
import { canonicalJson, sha256 } from "@napier/runtime";

import type {
  BrowserTaskBackend,
  BrowserTaskCreateInput,
  BrowserTaskEvent,
} from "./browser-task-types.js";

const MAX_JOURNAL_BYTES = 2 * 1024 * 1024;
const MAX_EVENTS = 128;

export interface BrowserTaskJournalRecord {
  taskId: string;
  backend: BrowserTaskBackend;
  status: "running" | "stopping" | "terminal";
  createdAt: number;
  input: BrowserTaskCreateInput;
  events: BrowserTaskEvent[];
}

interface PersistedBrowserTaskJournal extends BrowserTaskJournalRecord {
  kind: "napier.browser-task-journal";
  schemaVersion: 1;
  contentSha256: string;
}

export class BrowserTaskJournal {
  readonly #root: string;
  readonly #path: string;
  #writes = Promise.resolve();

  constructor(dataRoot: string) {
    this.#root = path.join(dataRoot, "browser-tasks");
    this.#path = path.join(this.#root, "latest.json");
  }

  async load(): Promise<BrowserTaskJournalRecord | undefined> {
    let bytes: Buffer;
    try {
      bytes = await readFile(this.#path);
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
    if (bytes.byteLength > MAX_JOURNAL_BYTES) {
      throw new Error("Browser task journal exceeds its size limit");
    }
    const value = JSON.parse(bytes.toString("utf8")) as unknown;
    if (!validJournal(value)) {
      throw new Error("Browser task journal is invalid");
    }
    const { contentSha256, ...content } = value;
    if (contentSha256 !== digest(content)) {
      throw new Error("Browser task journal hash is invalid");
    }
    return structuredClone({
      taskId: value.taskId,
      backend: value.backend,
      status: value.status,
      createdAt: value.createdAt,
      input: value.input,
      events: value.events,
    });
  }

  save(record: BrowserTaskJournalRecord): Promise<void> {
    const snapshot = structuredClone(record);
    const operation = this.#writes.then(() => this.#write(snapshot));
    this.#writes = operation.catch(() => undefined);
    return operation;
  }

  async #write(record: BrowserTaskJournalRecord): Promise<void> {
    const content = {
      kind: "napier.browser-task-journal" as const,
      schemaVersion: 1 as const,
      ...record,
    };
    const persisted: PersistedBrowserTaskJournal = {
      ...content,
      contentSha256: digest(content),
    };
    const text = `${JSON.stringify(persisted, null, 2)}\n`;
    if (Buffer.byteLength(text, "utf8") > MAX_JOURNAL_BYTES) {
      throw new Error("Browser task journal exceeds its size limit");
    }
    await mkdir(this.#root, { recursive: true });
    const temporary = path.join(
      this.#root,
      `.latest-${String(process.pid)}-${randomUUID()}.tmp`,
    );
    try {
      await writeFile(temporary, text, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, this.#path);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }
}

function validJournal(value: unknown): value is PersistedBrowserTaskJournal {
  if (!record(value)) return false;
  if (
    Object.keys(value).sort().join("\u0000") !==
    [
      "backend",
      "contentSha256",
      "createdAt",
      "events",
      "input",
      "kind",
      "schemaVersion",
      "status",
      "taskId",
    ]
      .sort()
      .join("\u0000")
  ) {
    return false;
  }
  const input = value["input"];
  const events = value["events"];
  return (
    value["kind"] === "napier.browser-task-journal" &&
    value["schemaVersion"] === 1 &&
    digestText(value["contentSha256"]) &&
    taskId(value["taskId"]) &&
    backend(value["backend"]) &&
    ["running", "stopping", "terminal"].includes(String(value["status"])) &&
    Number.isSafeInteger(value["createdAt"]) &&
    Number(value["createdAt"]) > 0 &&
    validInput(input, value["backend"]) &&
    Array.isArray(events) &&
    events.length <= MAX_EVENTS &&
    events.every(
      (event) =>
        record(event) &&
        event["backend"] === value["backend"] &&
        ["started", "step", "control", "completed", "error"].includes(
          String(event["type"]),
        ),
    )
  );
}

function validInput(value: unknown, expectedBackend: unknown): boolean {
  if (!record(value) || value["backend"] !== expectedBackend) return false;
  const model = value["model"];
  return (
    Object.keys(value).sort().join("\u0000") ===
      [
        "allowedDomains",
        "backend",
        "credentialEnv",
        "maxCostUsd",
        "maxSteps",
        "model",
        "startUrl",
        "task",
      ]
        .sort()
        .join("\u0000") &&
    text(value["task"], 1, 8_000) &&
    text(value["startUrl"], 1, 2_048) &&
    typeof value["credentialEnv"] === "string" &&
    value["credentialEnv"].length <= 128 &&
    record(model) &&
    Object.keys(model).sort().join("\u0000") === "id\u0000provider" &&
    text(model["provider"], 1, 32) &&
    text(model["id"], 1, 256) &&
    Array.isArray(value["allowedDomains"]) &&
    value["allowedDomains"].length >= 1 &&
    value["allowedDomains"].length <= 20 &&
    value["allowedDomains"].every((domain) => text(domain, 1, 253)) &&
    Number.isSafeInteger(value["maxSteps"]) &&
    typeof value["maxCostUsd"] === "number" &&
    Number.isFinite(value["maxCostUsd"])
  );
}

function digest(value: object): string {
  return sha256(canonicalJson(value as JsonValue));
}

function backend(value: unknown): value is BrowserTaskBackend {
  return value === "browser_use_local" || value === "browser_use_cloud";
}

function taskId(value: unknown): value is string {
  return (
    typeof value === "string" && /^browser_task_[a-f0-9]{32}$/u.test(value)
  );
}

function digestText(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function text(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length >= minimum &&
    value.length <= maximum
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
