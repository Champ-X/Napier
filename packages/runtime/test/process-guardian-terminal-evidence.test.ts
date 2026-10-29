import {
  access,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createParentGuardedTerminalLaunch } from "../src/process-guardian.js";
import { prepareTerminalGuardianReceipt } from "../src/process-guardian-terminal-evidence.js";
import { PROCESS_GUARDIAN_SPEC_ENV } from "../src/process-guardian-worker-source.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Guardian PTY final receipt integrity", () => {
  it("rejects a stale final ACK with a different launch nonce", async () => {
    const { prepared, receipt } = await fixture();
    await writeFile(
      receipt.path,
      JSON.stringify({
        nonce: "f".repeat(48),
        type: "exit",
        cleanup: {
          status: "released",
          scope: "sandbox_execution",
          reason: "guardian_cleanup_acknowledged",
        },
      }),
      { mode: 0o600 },
    );
    await expect(prepared.cleanup()).resolves.toMatchObject({
      status: "unknown",
      reason: "guardian_cleanup_receipt_invalid",
    });
    await expect(access(path.dirname(receipt.path))).rejects.toThrow();
  });

  it("rejects a symlink receipt without reading or changing its target", async () => {
    const { prepared, receipt, root } = await fixture();
    const target = path.join(root, "outside-ack.json");
    const content = JSON.stringify({
      nonce: receipt.nonce,
      type: "exit",
      cleanup: {
        status: "released",
        scope: "sandbox_execution",
        reason: "guardian_cleanup_acknowledged",
      },
    });
    await writeFile(target, content, { mode: 0o600 });
    await symlink(target, receipt.path);
    await expect(prepared.cleanup()).resolves.toMatchObject({
      status: "unknown",
    });
    expect(await readFile(target, "utf8")).toBe(content);
  });

  it("does not infer an ACK from an absent final receipt", async () => {
    const { prepared, receipt } = await fixture();
    await expect(prepared.cleanup()).resolves.toMatchObject({
      status: "unknown",
      reason: "guardian_cleanup_receipt_missing",
    });
    await expect(access(path.dirname(receipt.path))).rejects.toThrow();
  });
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-pty-ack-test-"));
  roots.push(root);
  const launch = createParentGuardedTerminalLaunch({
    command: process.execPath,
    args: ["--eval", "void 0"],
    cwd: root,
    env: {},
  });
  const prepared = await prepareTerminalGuardianReceipt(launch);
  if (!prepared) throw new Error("Missing Guardian receipt preparation");
  const spec = JSON.parse(
    Buffer.from(
      prepared.launch.env[PROCESS_GUARDIAN_SPEC_ENV]!,
      "base64",
    ).toString("utf8"),
  ) as { cleanupReceipt: { path: string; nonce: string } };
  return { root, prepared, receipt: spec.cleanupReceipt };
}
