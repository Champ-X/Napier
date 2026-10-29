import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  closeSync, constants, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync,
  openSync, readSync, unlinkSync, writeFileSync, type Stats,
} from "node:fs";
import path from "node:path";
import {
  encodeResourceCleanup, encodeResourceIdentity, validateResourceRequest,
  type ResourceCleanup, type ResourceKind,
} from "./workspace-resource-policy.js";
import { validWorkspaceRuntimeId } from "./workspace-runtime-identity.js";

const PROTOCOL = "owner-complete-v1";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const MAX_BYTES = 8_192;
export interface ResourceRecoveryTicket {
  schemaVersion: 1;
  protocol: typeof PROTOCOL;
  leaseId: string;
  nonce: string;
  ownerId: string;
  ownerPid: number;
  workspaceId: string;
  kind: ResourceKind;
  backend: string;
  receiptName: string;
}

export function createResourceRecoveryTicket(input: Omit<ResourceRecoveryTicket, "schemaVersion" | "protocol" | "nonce" | "receiptName">): string {
  return JSON.stringify({ schemaVersion: 1, protocol: PROTOCOL, ...input,
    nonce: randomBytes(24).toString("hex"), receiptName: `${input.leaseId}.json` });
}

export function parseResourceRecoveryTicket(encoded: string): ResourceRecoveryTicket | undefined {
  try {
    const value: unknown = JSON.parse(encoded);
    if (JSON.stringify(value) !== encoded || !keys(value, ["schemaVersion", "protocol", "leaseId", "nonce", "ownerId", "ownerPid", "workspaceId", "kind", "backend", "receiptName"]) ||
        value["schemaVersion"] !== 1 || value["protocol"] !== PROTOCOL ||
        typeof value["leaseId"] !== "string" || !UUID.test(value["leaseId"]) ||
        typeof value["nonce"] !== "string" || !/^[a-f0-9]{48}$/u.test(value["nonce"]) ||
        typeof value["ownerId"] !== "string" || !UUID.test(value["ownerId"]) ||
        !Number.isSafeInteger(value["ownerPid"]) || Number(value["ownerPid"]) <= 0 ||
        typeof value["workspaceId"] !== "string" || !validWorkspaceRuntimeId(value["workspaceId"]) ||
        value["receiptName"] !== `${value["leaseId"]}.json`) return undefined;
    validateResourceRequest({ kind: value["kind"] as ResourceKind, backend: value["backend"] as string });
    return value as unknown as ResourceRecoveryTicket;
  } catch { return undefined; }
}

/** This is an owner-complete record, never a Guardian/bridge component ACK. */
function receiptBody(ticketJson: string, identityJson: string | null, cleanupJson: string) {
  const ticket = parseResourceRecoveryTicket(ticketJson);
  if (!ticket) throw new Error("Invalid resource recovery ticket");
  const cleanup: unknown = JSON.parse(cleanupJson);
  if (!keys(cleanup, ["status", "scope", "reason"]) || cleanup["status"] === "unknown" ||
      encodeResourceCleanup(cleanup as unknown as ResourceCleanup, ticket.kind) !== cleanupJson)
    throw new Error("Invalid complete resource receipt cleanup");
  const identity: unknown = identityJson === null ? null : JSON.parse(identityJson);
  if (identity !== null && (!keys(identity, ["resourceId"], ["identitySha256"]) ||
      encodeResourceIdentity(identity as { resourceId: string; identitySha256?: string }) !== identityJson))
    throw new Error("Invalid complete resource receipt identity");
  return { schemaVersion: 1, protocol: PROTOCOL, leaseId: ticket.leaseId, nonce: ticket.nonce,
    ticketSha256: digest(ticketJson), resourceIdentity: identity, cleanup,
    completionScope: "entire-admitted-resource" };
}

export interface VerifiedResourceReceipt { cleanupJson: string; receiptSha256: string }

/** Private, bounded, no-follow files. Receipt publication never overwrites proof. */
export class WorkspaceResourceReceipts {
  private readonly root: string;
  private readonly descriptor: number;
  private readonly identity: Stats;

  constructor(stateHome: string) {
    this.root = path.join(stateHome, "execution-resource-receipts");
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    this.descriptor = openSync(this.root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      this.identity = fstatSync(this.descriptor);
      this.assertRoot();
      const parent = openSync(stateHome, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try { fsyncSync(parent); } finally { closeSync(parent); }
    } catch (error) { closeSync(this.descriptor); throw error; }
  }

  close(): void { closeSync(this.descriptor); }

  publish(ticketJson: string, identityJson: string | null, cleanupJson: string): string {
    const content = receiptBody(ticketJson, identityJson, cleanupJson);
    const text = JSON.stringify({ ...content, contentSha256: digest(JSON.stringify(content)) });
    if (Buffer.byteLength(text) > MAX_BYTES) throw new Error("Resource receipt exceeds its size limit");
    this.assertRoot();
    const destination = path.join(this.root, `${content.leaseId}.json`);
    const temporary = path.join(this.root, `.${content.leaseId}.${randomUUID()}.tmp`);
    let file: number | undefined;
    try {
      file = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      writeFileSync(file, text);
      fsyncSync(file);
      const written = fstatSync(file);
      closeSync(file); file = undefined;
      let installed = false;
      try { linkSync(temporary, destination); installed = true; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      unlinkSync(temporary);
      const published = lstatSync(destination);
      if (installed && (published.dev !== written.dev || published.ino !== written.ino))
        throw new Error("Published resource receipt identity changed");
      if (this.readFile(destination, true) !== text) throw new Error("Conflicting complete resource receipt");
      fsyncSync(this.descriptor);
      this.assertRoot();
      return digest(text);
    } finally {
      if (file !== undefined) closeSync(file);
      try { unlinkSync(temporary); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }

  verify(ticketJson: string, identityJson: string | null): VerifiedResourceReceipt | undefined {
    try {
      const ticket = parseResourceRecoveryTicket(ticketJson);
      if (!ticket) return undefined;
      const text = this.readFile(path.join(this.root, ticket.receiptName));
      const value: unknown = JSON.parse(text);
      if (!keys(value, ["schemaVersion", "protocol", "leaseId", "nonce", "ticketSha256", "resourceIdentity", "cleanup", "completionScope", "contentSha256"])) return undefined;
      const cleanupJson = JSON.stringify(value["cleanup"]);
      const expected = receiptBody(ticketJson, identityJson, cleanupJson);
      // Compare complete canonical content, including nonce, scope and immutable identity.
      if (text !== JSON.stringify({ ...expected, contentSha256: digest(JSON.stringify(expected)) })) return undefined;
      return { cleanupJson, receiptSha256: digest(text) };
    } catch { return undefined; }
  }

  private readFile(filename: string, sync = false): string {
    this.assertRoot();
    const file = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = fstatSync(file);
      if (!before.isFile() || !privateOwner(before) || before.nlink !== 1 || before.size > MAX_BYTES)
        throw new Error("Invalid private resource receipt");
      const bytes = Buffer.alloc(MAX_BYTES + 1);
      const count = readSync(file, bytes, 0, bytes.length, 0);
      const after = fstatSync(file);
      if (count !== before.size || count > MAX_BYTES || before.size !== after.size ||
          before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || after.nlink !== 1)
        throw new Error("Resource receipt changed during observation");
      if (sync) fsyncSync(file);
      this.assertRoot();
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, count));
    } finally { closeSync(file); }
  }

  private assertRoot(): void {
    const current = lstatSync(this.root);
    if (!current.isDirectory() || current.isSymbolicLink() || !privateOwner(current) ||
        current.dev !== this.identity.dev || current.ino !== this.identity.ino)
      throw new Error("Invalid private resource receipt directory");
  }
}

function privateOwner(stat: Stats): boolean {
  return (stat.mode & 0o077) === 0 && (!process.getuid || stat.uid === process.getuid());
}
function keys(value: unknown, required: string[], optional: string[] = []): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
}
function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
