import type {
  BrowserSessionOwner,
  BrowserSessionRequest,
} from "./browser-session-model.js";
import {
  assertBrowserPreparedUpload,
  type BrowserPreparedUpload,
  prepareBrowserUpload,
} from "./browser-workspace-files.js";
import { sha256 } from "./ed25519.js";
import { toolInvocationArgumentsSha256 } from "./tool-invocation-capsule.js";

export const MAX_PREPARED_BROWSER_UPLOADS = 4;

export interface BrowserUploadAuthorizationCandidate {
  owner: BrowserSessionOwner;
  callId: string;
  argumentsSha256: string;
  upload: BrowserPreparedUpload;
}

export class BrowserUploadAuthorizationManager {
  private readonly prepared = new Map<
    string,
    BrowserUploadAuthorizationCandidate
  >();
  private readonly approved = new Map<
    string,
    BrowserUploadAuthorizationCandidate
  >();
  private preparing = 0;

  constructor(private readonly workspaceRoot: string) {}

  async prepare(input: {
    owner: BrowserSessionOwner;
    callId: string;
    request: Extract<BrowserSessionRequest, { action: "upload" }>;
  }): Promise<BrowserUploadAuthorizationCandidate> {
    validateIdentity(input.owner, input.callId);
    const key = authorizationKey(input.owner, input.callId);
    if (
      this.prepared.has(key) ||
      this.approved.has(key) ||
      this.prepared.size + this.approved.size + this.preparing >=
        MAX_PREPARED_BROWSER_UPLOADS
    ) {
      throw new Error("Browser prepared upload limit reached");
    }
    this.preparing += 1;
    try {
      const upload = await prepareBrowserUpload(
        this.workspaceRoot,
        input.request.path,
      ).catch(() => {
        throw new Error(
          "Browser upload could not be prepared for confirmation",
        );
      });
      const candidate = {
        owner: structuredClone(input.owner),
        callId: input.callId,
        argumentsSha256: toolInvocationArgumentsSha256(input.request),
        upload,
      };
      try {
        validateCandidate(candidate);
      } catch (error) {
        upload.buffer.fill(0);
        throw error;
      }
      this.prepared.set(key, candidate);
      return candidate;
    } finally {
      this.preparing -= 1;
    }
  }

  approve(candidate: BrowserUploadAuthorizationCandidate): void {
    validateCandidate(candidate);
    const key = authorizationKey(candidate.owner, candidate.callId);
    if (this.prepared.get(key) !== candidate || this.approved.has(key)) {
      throw new Error("Browser prepared upload is unavailable");
    }
    this.prepared.delete(key);
    this.approved.set(key, candidate);
  }

  discard(candidate: BrowserUploadAuthorizationCandidate): void {
    const key = authorizationKey(candidate.owner, candidate.callId);
    if (this.prepared.get(key) !== candidate) return;
    this.prepared.delete(key);
    candidate.upload.buffer.fill(0);
  }

  consume(input: {
    owner: BrowserSessionOwner;
    callId: string;
    request: Extract<BrowserSessionRequest, { action: "upload" }>;
  }): BrowserPreparedUpload {
    validateIdentity(input.owner, input.callId);
    const key = authorizationKey(input.owner, input.callId);
    const candidate = this.approved.get(key);
    this.approved.delete(key);
    if (
      !candidate ||
      candidate.argumentsSha256 !== toolInvocationArgumentsSha256(input.request)
    ) {
      candidate?.upload.buffer.fill(0);
      throw new Error("Browser upload authorization is unavailable");
    }
    return candidate.upload;
  }

  cancelRun(owner: BrowserSessionOwner): void {
    const prefix = `${owner.threadId}\u0000${owner.runId}\u0000`;
    for (const candidates of [this.prepared, this.approved]) {
      for (const [key, candidate] of candidates) {
        if (!key.startsWith(prefix)) continue;
        candidates.delete(key);
        candidate.upload.buffer.fill(0);
      }
    }
  }
}

function validateCandidate(
  candidate: BrowserUploadAuthorizationCandidate,
): void {
  validateIdentity(candidate.owner, candidate.callId);
  if (
    !/^[a-f0-9]{64}$/u.test(candidate.argumentsSha256) ||
    candidate.upload.pathSha256 !== sha256(candidate.upload.path) ||
    !/^[a-f0-9]{64}$/u.test(candidate.upload.fileSha256) ||
    candidate.upload.name === ""
  ) {
    throw new Error("Browser upload authorization is invalid");
  }
  assertBrowserPreparedUpload(candidate.upload);
}

function validateIdentity(owner: BrowserSessionOwner, callId: string): void {
  if (!owner.threadId || !owner.runId || !callId) {
    throw new Error("Browser upload authorization identity is invalid");
  }
}

function authorizationKey(owner: BrowserSessionOwner, callId: string): string {
  return `${owner.threadId}\u0000${owner.runId}\u0000${callId}`;
}
