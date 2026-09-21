import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { containerVerificationArgs } from "../src/verification-container-entry.js";
import { runSandboxedProcess } from "../src/sandboxed-process.js";
import { HostDirectSandboxAdapter } from "../src/sandbox-host-direct.js";

async function fixture(action: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), "napier-container-entry-"));
  try {
    await action(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

it("preserves verifier argv, stdout and failure status through a shell-free entry", () =>
  fixture(async (root) => {
    const workspace = path.join(root, "workspace spaces;$not_a_variable");
    await mkdir(path.join(workspace, "nested"), { recursive: true });
    await writeFile(path.join(workspace, "nested/value.txt"), "original");
    await symlink(workspace, path.join(workspace, "loop"), "dir");
    const args = [
      "-e",
      "console.log(JSON.stringify(process.argv.slice(1)));process.exitCode=37",
      "--",
      "literal;$value",
      "spaced argument",
    ];
    const result = spawnSync(
      process.execPath,
      containerVerificationArgs("oci-container", workspace, args),
      { cwd: workspace, encoding: "utf8", timeout: 3000 },
    );
    expect(result.status, result.stderr).toBe(37);
    expect(JSON.parse(result.stdout)).toEqual([
      "literal;$value",
      "spaced argument",
    ]);
    expect(
      await readFile(path.join(workspace, "nested/value.txt"), "utf8"),
    ).toBe("original");
  }));

it("does not launch a verifier when workspace enumeration fails", () =>
  fixture(async (root) => {
    const result = spawnSync(
      process.execPath,
      containerVerificationArgs("oci-container", path.join(root, "missing"), [
        "-e",
        "console.log('VERIFIER_STARTED')",
      ]),
      { encoding: "utf8", timeout: 3000 },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("OCI verification launch failed");
    expect(result.stdout).not.toContain("VERIFIER_STARTED");
  }));

it("the existing execution timeout still terminates the wrapped verifier process tree", () =>
  fixture(async (root) => {
    const sentinel = path.join(root, "late-write");
    const result = await runSandboxedProcess({
      sandbox: new HostDirectSandboxAdapter(),
      launch: {
        command: process.execPath,
        args: containerVerificationArgs("oci-container", root, [
          "-e",
          "setTimeout(()=>require('node:fs').writeFileSync(process.argv[1],'late'),900);setInterval(()=>{},1000)",
          sentinel,
        ]),
        cwd: root,
        workspaceRoot: root,
        env: {},
        approvedCapabilities: [
          "process.spawn",
          "workspace.read",
          "workspace.write",
        ],
      },
      timeoutMs: 300,
      maxOutputChars: 1000,
      abortedMessage: "aborted",
    });
    expect(result.status).toBe("timed_out");
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await expect(readFile(sentinel)).rejects.toMatchObject({ code: "ENOENT" });
  }));
