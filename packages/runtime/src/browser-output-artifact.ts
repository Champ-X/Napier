import { sha256 } from "./ed25519.js";
import {
  RunBoundFileArtifactRegistrar,
  type RunBoundFileArtifactRegistration,
  type RunBoundFileArtifactStore,
} from "./run-bound-file-artifact.js";
import type { LocalStore } from "./store.js";

type BrowserOutputArtifactStore = RunBoundFileArtifactStore &
  Pick<LocalStore, "workspaceRoot">;

export interface BrowserOutputArtifact {
  path: string;
  pathSha256: string;
  fileSha256: string;
  fileBytes: number;
  action: "download" | "save_screenshot";
}

export type BrowserOutputArtifactRegistration =
  RunBoundFileArtifactRegistration;

export class BrowserOutputArtifactRegistrar {
  private readonly files: RunBoundFileArtifactRegistrar;

  constructor(store: BrowserOutputArtifactStore) {
    this.files = new RunBoundFileArtifactRegistrar(store);
  }

  async register(
    owner: { threadId: string; runId: string },
    output: BrowserOutputArtifact,
  ): Promise<BrowserOutputArtifactRegistration> {
    validateOutput(output);
    return this.files.register(owner, {
      path: output.path,
      fileSha256: output.fileSha256,
      fileBytes: output.fileBytes,
      producedEvidence: browserOutputEvidence(output),
      verifiedEvidence: browserOutputVerificationEvidence(output),
    });
  }
}

function browserOutputEvidence(output: BrowserOutputArtifact): string {
  return output.action === "save_screenshot"
    ? "Browser takeover saved the declared screenshot workspace output."
    : "Browser takeover saved the declared download workspace output.";
}

function browserOutputVerificationEvidence(
  output: BrowserOutputArtifact,
): string {
  return output.action === "save_screenshot"
    ? "Browser output registration verified the declared screenshot bytes."
    : "Browser output registration verified the declared download bytes.";
}

function validateOutput(output: BrowserOutputArtifact): void {
  if (
    output.pathSha256 !== sha256(output.path) ||
    !/^[a-f0-9]{64}$/u.test(output.fileSha256) ||
    !Number.isSafeInteger(output.fileBytes) ||
    output.fileBytes < 1
  ) {
    throw new Error("Browser output Artifact evidence is invalid");
  }
}
