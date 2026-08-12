import { execFile as execFileWithCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  S1_RUN_AUTHORITY_CONFIG,
  validateS1UpstreamRunAuthority,
} from "./s1-upstream-run-authority.mjs";
import { sha256 } from "./sandbox-external-publication-model.mjs";

const execFile = promisify(execFileWithCallback);

export async function requireReleaseSourceAncestor(
  repoRoot,
  releaseSourceSha,
  sourceSha,
) {
  if (releaseSourceSha === sourceSha) return;
  try {
    await execFile(
      "git",
      [
        "-C",
        repoRoot,
        "merge-base",
        "--is-ancestor",
        releaseSourceSha,
        sourceSha,
      ],
      {
        env: {
          LANG: "C",
          PATH: process.env.PATH ?? "",
        },
        timeout: 10_000,
        maxBuffer: 16 * 1024,
      },
    );
  } catch {
    throw new Error(
      "S1 release source SHA is not an ancestor of completion source",
    );
  }
}

export async function loadVerifiedS1RunAuthority(options) {
  if (
    typeof options.artifactPath !== "string" ||
    !path.isAbsolute(options.artifactPath)
  ) {
    throw new Error("S1 upstream run authority path must be absolute");
  }
  const bytes = await readFile(options.artifactPath);
  let authority;
  try {
    authority = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("S1 upstream run authority is not valid JSON");
  }
  const errors = validateS1UpstreamRunAuthority(authority, {
    authority: options.authority,
    sourceSha: options.sourceSha,
    workflowRunId: options.expectedRunId,
  });
  if (errors.length > 0) {
    throw new Error(
      `S1 upstream run authority verification failed: ${errors.join("; ")}`,
    );
  }
  return { value: authority, fileSha256: sha256(bytes) };
}

export function requireReceiptAuthorityMatch(receipt, authority) {
  const config = S1_RUN_AUTHORITY_CONFIG[authority.authority];
  if (
    receipt.workflow !== config.workflow ||
    receipt.workflowRunId !== authority.workflowRunId ||
    receipt.workflowRunAttempt !== authority.workflowRunAttempt ||
    receipt.sourceSha !== authority.sourceSha
  ) {
    throw new Error("S1 upstream receipt does not match run authority");
  }
}
