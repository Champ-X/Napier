import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { acquireWorkspacePathLocks, withWorkspacePathLock } from "../src/workspace-write-lock.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("workspace write locks", () => {
  it("keeps an old ownerless legacy lock unknown instead of inferring death from age", async () => {
    const root = await temporaryRoot();
    const target = path.join(root, "workspace.json");
    const lockPath = await writeIncompleteLock(root, target);
    const staleAt = new Date(Date.now() - 60_000);
    await utimes(lockPath, staleAt, staleAt);

    let entered = false;
    await expect(withWorkspacePathLock(root, target, async () => {
      entered = true;
    })).rejects.toThrow("target is already being edited");

    expect(entered).toBe(false);
  });

  it("does not steal a recent incomplete lock", async () => {
    const root = await temporaryRoot();
    const target = path.join(root, "workspace.json");
    await writeIncompleteLock(root, target);

    await expect(
      withWorkspacePathLock(root, target, async () => undefined),
    ).rejects.toThrow("target is already being edited");
  });

  it("respects a live legacy PID owner even when the file is old", async () => {
    const root = await temporaryRoot(), target = path.join(root, "workspace.json");
    const lockPath = await writeIncompleteLock(root, target);
    await writeFile(lockPath, JSON.stringify({ pid: process.pid }));
    const staleAt = new Date(Date.now() - 60_000);
    await utimes(lockPath, staleAt, staleAt);
    await expect(withWorkspacePathLock(root, target, async () => undefined)).rejects.toThrow("already being edited");
    expect(JSON.parse(await readFile(lockPath, "utf8"))).toEqual({ pid: process.pid });
  });

  it("an old lease release cannot delete a replacement owner lock", async () => {
    const root = await temporaryRoot(), target = path.join(root, "workspace.json");
    const first = await acquireWorkspacePathLocks(root, [target], "First");
    const lockPath = lockFor(root, target);
    await rename(lockPath, `${lockPath}.old`);
    const second = await acquireWorkspacePathLocks(root, [target], "Second");
    const replacement = await readFile(lockPath, "utf8");
    try {
      await first.release();
      expect(await readFile(lockPath, "utf8")).toBe(replacement);
      await expect(acquireWorkspacePathLocks(root, [target], "Third")).rejects.toThrow("already being edited");
    } finally { await first.release(); await second.release(); }
  });

  it("releases only its own partial acquisition when a later target is busy", async () => {
    const root = await temporaryRoot(), targets = [path.join(root, "a"), path.join(root, "b")];
    const held = await acquireWorkspacePathLocks(root, [targets[1]!], "Held");
    try {
      await expect(acquireWorkspacePathLocks(root, targets, "Contender")).rejects.toThrow("already being edited");
      const first = await acquireWorkspacePathLocks(root, [targets[0]!], "Independent");
      await first.release();
      await expect(acquireWorkspacePathLocks(root, [targets[1]!], "Third")).rejects.toThrow("already being edited");
    } finally { await held.release(); }
  });

  it("ordinary wrapper release succeeds while the coordinator is busy without retaining or retrying a lease", async () => {
    const root = await temporaryRoot(), target = path.join(root, "workspace.json");
    let blocker: DatabaseSync | undefined;
    try {
      await expect(withWorkspacePathLock(root, target, async () => {
        blocker = new DatabaseSync(path.join(root, "file-edit-locks.sqlite"));
        blocker.exec("BEGIN IMMEDIATE");
        return "operation completed";
      })).resolves.toBe("operation completed");
      expect(await readdir(path.join(root, "file-edit-locks"))).toEqual([]);
      await expect(acquireWorkspacePathLocks(root, [target], "Contender")).rejects.toThrow("already being edited");
      blocker!.exec("COMMIT"); blocker!.close(); blocker = undefined;
      await expect(withWorkspacePathLock(root, target, async () => "acquired normally")).resolves.toBe("acquired normally");
    } finally { if (blocker) { if (blocker.isTransaction) blocker.exec("ROLLBACK"); blocker.close(); } }
  });

  it("serializes independent processes reclaiming a dead owner and a subsequently killed winner", async () => {
    const root = await temporaryRoot(), target = path.join(root, "target");
    const dead = spawn(process.execPath, ["-e", "process.exit(0)"]);
    await once(dead, "exit");
    const lockPath = await writeIncompleteLock(root, target);
    await writeFile(lockPath, JSON.stringify({ pid: dead.pid }));
    const peers = await Promise.all([lockPeer(root), lockPeer(root), lockPeer(root)]);
    try {
      peers.forEach((peer) => peer.child.stdin.write("acquire\n"));
      await until(() => peers.every((peer) => /acquired|busy/u.test(peer.output())));
      expect(peers.filter((peer) => peer.output().includes("acquired"))).toHaveLength(1);
      const winner = peers.find((peer) => peer.output().includes("acquired"))!;
      winner.child.kill("SIGKILL"); await winner.exited;
      const survivors = peers.filter((peer) => peer !== winner);
      survivors.forEach((peer) => peer.child.stdin.write("acquire\n"));
      await until(() => survivors.every((peer) => peer.output().trim().split("\n").length === 3));
      expect(survivors.filter((peer) => peer.output().includes("acquired"))).toHaveLength(1);
    } finally {
      for (const peer of peers) if (peer.child.exitCode === null && peer.child.signalCode === null) peer.child.stdin.end("stop\n");
      await Promise.all(peers.map((peer) => peer.exited));
    }
  }, 30_000);

  it.skipIf(process.platform === "win32")("does not block the metadata coordinator when a lock file races into a FIFO", async () => {
    const root = await temporaryRoot();
    await writeIncompleteLock(root, path.join(root, "target"));
    await writeFile(lockFor(root, path.join(root, "target")), JSON.stringify({ pid: process.pid }));
    const fixture = fileURLToPath(new URL("./fixtures/workspace-write-lock-process.ts", import.meta.url));
    const result = await promisify(execFile)(process.execPath, ["--import", "tsx", fixture, root, "race-fifo"], { timeout: 5_000 });
    expect(result.stdout).toBe("fifo-busy\n");
  });

  it("keeps one owner while independent processes release and acquire concurrently", async () => {
    const root = await temporaryRoot(), peers = await Promise.all([lockPeer(root), lockPeer(root)]);
    const command = async (peer: (typeof peers)[number], action: string) => {
      const before = peer.output().trim().split("\n").length;
      peer.child.stdin.write(`${action}\n`);
      await until(() => peer.output().trim().split("\n").length > before);
      return peer.output().trim().split("\n").at(-1);
    };
    try {
      expect(await command(peers[0]!, "acquire")).toBe("acquired");
      for (let index = 0; index < 6; index += 1) {
        const owner = peers[index % 2]!, next = peers[(index + 1) % 2]!;
        const [released, attempted] = await Promise.all([command(owner, "release"), command(next, "acquire")]);
        expect(released).toBe("released");
        expect(["busy", "acquired"]).toContain(attempted);
        if (attempted === "busy") expect(await command(next, "acquire")).toBe("acquired");
        expect(await command(owner, "acquire")).toBe("busy");
        const record = JSON.parse(await readFile(lockFor(root, path.join(root, "target")), "utf8")) as { pid: number };
        expect(record.pid).toBe(next.child.pid);
      }
    } finally {
      for (const peer of peers) peer.child.stdin.end("stop\n");
      await Promise.all(peers.map((peer) => peer.exited));
    }
  }, 30_000);
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-write-lock-"));
  temporaryRoots.push(root);
  return root;
}

async function writeIncompleteLock(
  root: string,
  target: string,
): Promise<string> {
  const locksRoot = path.join(root, "file-edit-locks");
  await mkdir(locksRoot, { recursive: true });
  const lockPath = lockFor(root, target);
  await writeFile(lockPath, "", "utf8");
  return lockPath;
}

function lockFor(root: string, target: string): string {
  const resolved = path.resolve(target);
  const identity =
    process.platform === "darwin" || process.platform === "win32"
      ? resolved.toLowerCase()
      : resolved;
  return path.join(
    root, "file-edit-locks",
    `${createHash("sha256").update(identity).digest("hex")}.lock`,
  );
}

async function lockPeer(root: string) {
  const fixture = fileURLToPath(new URL("./fixtures/workspace-write-lock-process.ts", import.meta.url));
  const child = spawn(process.execPath, ["--import", "tsx", fixture, root], { stdio: ["pipe", "pipe", "pipe"] });
  const exited = once(child, "exit");
  let output = "", errors = "";
  child.stdout.on("data", (data: Buffer) => { output += data.toString(); });
  child.stderr.on("data", (data: Buffer) => { errors += data.toString(); });
  await until(() => {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(errors);
    return output.includes("ready\n");
  });
  return { child, exited, output: () => output };
}
async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Lock process barrier timed out");
    await delay(20);
  }
}
