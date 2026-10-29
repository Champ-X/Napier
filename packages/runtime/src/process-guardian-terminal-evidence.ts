import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ExecutionResourceCleanup } from "./execution-resource-admission.js";
import {
  PROCESS_GUARDIAN_SPEC_ENV,
  PROCESS_GUARDIAN_WORKER_SOURCE,
} from "./process-guardian-worker-source.js";
import { sandboxCleanup } from "./sandbox-execution-evidence.js";

/** PTYs cannot carry fd4, so the guardian writes a private, one-use final ACK. */
export async function prepareTerminalGuardianReceipt<
  Request extends {
    command: string;
    args: string[];
    env: Record<string, string>;
  },
>(request: Request) {
  const encoded = request.env[PROCESS_GUARDIAN_SPEC_ENV];
  if (
    !encoded ||
    request.command !== process.execPath ||
    !request.args.includes(PROCESS_GUARDIAN_WORKER_SOURCE)
  )
    return undefined;
  const spec = JSON.parse(
    Buffer.from(encoded, "base64").toString("utf8"),
  ) as Record<string, unknown>;
  const home = await mkdtemp(path.join(tmpdir(), "napier-guardian-receipt-"));
  const nonce = randomBytes(24).toString("hex");
  const receiptPath = path.join(home, "cleanup.json");
  const launch: Request = {
    ...request,
    env: {
      ...request.env,
      [PROCESS_GUARDIAN_SPEC_ENV]: Buffer.from(
        JSON.stringify({
          ...spec,
          cleanupReceipt: { path: receiptPath, nonce },
        }),
      ).toString("base64"),
    },
  };
  return {
    launch,
    discard: () => rm(home, { recursive: true, force: true }),
    async cleanup(): Promise<ExecutionResourceCleanup> {
      let evidence: ExecutionResourceCleanup;
      try {
        evidence = await readReceipt(receiptPath, nonce);
      } catch {
        evidence = sandboxCleanup(
          "unknown",
          "guardian_cleanup_receipt_missing",
        );
      }
      try {
        await rm(home, { recursive: true, force: true });
      } catch {
        return sandboxCleanup("unknown", "guardian_receipt_cleanup_failed");
      }
      return evidence;
    },
  };
}

async function readReceipt(
  receiptPath: string,
  nonce: string,
): Promise<ExecutionResourceCleanup> {
  const file = await open(
    receiptPath,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const before = await file.stat();
    if (
      !before.isFile() ||
      before.size > 4_096 ||
      (before.mode & 0o077) !== 0 ||
      before.nlink !== 1
    )
      return sandboxCleanup("unknown", "guardian_cleanup_receipt_invalid");
    const body = JSON.parse(await file.readFile("utf8")) as Record<
      string,
      unknown
    >;
    const after = await file.stat();
    const cleanup = body["cleanup"] as Record<string, unknown> | undefined;
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      body["nonce"] !== nonce ||
      body["type"] !== "exit" ||
      !cleanup ||
      cleanup["scope"] !== "sandbox_execution" ||
      !["not_started", "released", "unknown"].includes(
        String(cleanup["status"]),
      ) ||
      typeof cleanup["reason"] !== "string" ||
      !/^[a-z_]{1,80}$/.test(cleanup["reason"])
    )
      return sandboxCleanup("unknown", "guardian_cleanup_receipt_invalid");
    return {
      status: cleanup["status"] as ExecutionResourceCleanup["status"],
      scope: "sandbox_execution",
      reason: cleanup["reason"],
    };
  } finally {
    await file.close();
  }
}
