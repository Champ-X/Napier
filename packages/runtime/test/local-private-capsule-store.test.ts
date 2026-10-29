import { fork, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalPrivateCapsuleStore } from "../src/local-private-capsule-store.js";

const execute = promisify(execFile);
const roots: string[] = [];
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
interface Capsule { text: string }
const serialized = (text: string) => JSON.stringify({ text });
const contentHash = (value: Capsule) => digest(serialized(value.text));
function store(dataRoot: string, maxObjects = 32) {
  return new LocalPrivateCapsuleStore<Capsule>({ dataRoot, directory: "test-capsules", label: "Test",
    maxObjectBytes: 1024, maxObjects, maxStorageBytes: 32768, requireDurableDirectory: true,
    parse: (value) => JSON.parse(value) as Capsule, contentSha256: contentHash });
}
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-private-capsule-"));
  roots.push(root);
  return { root, capsules: store(root) };
}
afterEach(async () => {
  vi.doUnmock("node:fs"); vi.doUnmock("node:fs/promises"); vi.resetModules();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("private capsule platform capability scope (injected capabilities, real files)", () => {
  it("keeps construction and compatibility I/O available but rejects strict I/O when POSIX flags are absent", async () => {
    const { root } = await fixture();
    const create = await capabilityFixture("flags");
    const compatible = create(root, false);
    const value = { text: "compatible" }; const hash = contentHash(value);
    await compatible.put(hash, serialized(value.text));
    expect(await compatible.readWithBytes(hash)).toEqual({ value, bytes: Buffer.byteLength(serialized(value.text)) });
    const strict = create(path.join(root, "strict"), true);
    await expect(strict.put(hash, serialized(value.text))).rejects.toThrow(/filesystem guarantees are unavailable/u);
    await expect(strict.read(hash)).rejects.toMatchObject({ name: "LocalPrivateCapsuleDurabilityUnavailableError" });
    await expect(stat(strict.rootPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["directory-open", "directory-sync"] as const)("tolerates unsupported %s only for compatibility stores", async (fault) => {
    const { root } = await fixture();
    const create = await capabilityFixture(fault);
    const value = { text: fault }; const hash = contentHash(value);
    const compatible = create(root, false);
    await compatible.put(hash, serialized(value.text));
    expect(await compatible.read(hash)).toEqual(value);
    const strict = create(path.join(root, "strict"), true);
    await expect(strict.put(hash, serialized(value.text))).rejects.toMatchObject({ name: "LocalPrivateCapsuleDurabilityUnavailableError" });
    await expect(stat(path.join(strict.rootPath, `${hash}.json`))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([{ fault: "directory-sync", code: "EIO" }, { fault: "directory-sync", code: "ENOSPC" },
    { fault: "directory-open", code: "EACCES" }, { fault: "file-sync", code: "ENOTSUP" }] as const)(
    "never classifies $code for $fault as a missing capability", async ({ fault, code }) => {
      const { root } = await fixture();
      const create = await capabilityFixture(fault, code);
      for (const strict of [false, true]) {
        const capsules = create(path.join(root, String(strict)), strict); const value = { text: "must-fail" };
        const failure: unknown = await capsules.put(contentHash(value), serialized(value.text)).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(Error);
        expect(failure).not.toMatchObject({ name: "LocalPrivateCapsuleDurabilityUnavailableError" });
        await expect(stat(path.join(capsules.rootPath, `${contentHash(value)}.json`))).rejects.toMatchObject({ code: "ENOENT" });
      }
    });
});

describe("private capsule filesystem boundary", () => {
  it("returns the immutable installed byte count for a differently formatted duplicate", async () => {
    const { root, capsules } = await fixture();
    const value = { text: "immutable" };
    const hash = contentHash(value);
    const text = JSON.stringify(value);
    await capsules.put(hash, text);
    const target = path.join(capsules.rootPath, `${hash}.json`);
    const before = await stat(target);
    const duplicate = await store(root).put(hash, JSON.stringify(value, null, 4));
    expect(duplicate.bytes).toBe(Buffer.byteLength(text));
    expect(await capsules.readWithBytes(hash)).toEqual({ value, bytes: Buffer.byteLength(text) });
    expect(await readFile(target, "utf8")).toBe(text);
    expect((await stat(target)).ino).toBe(before.ino);
    expect(before.mode & 0o777).toBe(0o600);
    expect((await stat(capsules.rootPath)).mode & 0o777).toBe(0o700);
  });

  it("rejects invalid UTF-8 instead of accepting replacement characters under a valid semantic hash", async () => {
    const { capsules } = await fixture();
    const hash = contentHash({ text: "\ufffd" });
    await mkdir(capsules.rootPath, { mode: 0o700 });
    await writeFile(path.join(capsules.rootPath, `${hash}.json`), Buffer.concat([
      Buffer.from('{"text":"'), Buffer.from([0xff]), Buffer.from('"}'),
    ]), { mode: 0o600 });
    await expect(capsules.read(hash)).rejects.toThrow(/UTF-8/u);
  });

  it("rejects a serialization that UTF-8 encoding would change before installing a pointer target", async () => {
    const { capsules } = await fixture();
    const value = { text: "\ud800" };
    await expect(capsules.put(contentHash(value), '{"text":"\ud800"}')).rejects.toThrow(/UTF-8/u);
    await expect(stat(capsules.rootPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a symlinked store root without reading an otherwise valid external capsule", async () => {
    const { root, capsules } = await fixture();
    const outside = path.join(root, "outside");
    await mkdir(outside, { mode: 0o700 });
    const value = { text: "outside" };
    const hash = contentHash(value);
    await writeFile(path.join(outside, `${hash}.json`), JSON.stringify(value), { mode: 0o600 });
    await symlink(outside, capsules.rootPath, "dir");
    await expect(capsules.read(hash)).rejects.toThrow();
    expect(await readFile(path.join(outside, `${hash}.json`), "utf8")).toBe(JSON.stringify(value));
  });

  it("rejects leaf symlinks, exposed permissions, oversized files and path hash mismatches", async () => {
    const { root, capsules } = await fixture();
    const value = { text: "private" };
    const hash = contentHash(value);
    await capsules.put(hash, JSON.stringify(value));
    const target = path.join(capsules.rootPath, `${hash}.json`);
    await chmod(target, 0o644);
    await expect(capsules.read(hash)).rejects.toThrow(/file is invalid/u);
    await chmod(target, 0o600);
    await writeFile(target, "x".repeat(1025));
    await expect(capsules.read(hash)).rejects.toThrow(/file is invalid/u);
    await writeFile(target, serialized("changed"));
    await expect(capsules.read(hash)).rejects.toThrow(/binding is invalid/u);
    await rm(target);
    const outside = path.join(root, "outside.json");
    await writeFile(outside, JSON.stringify(value), { mode: 0o600 });
    await symlink(outside, target);
    await expect(capsules.read(hash)).rejects.toThrow();
  });

  it("rejects a FIFO immediately and refuses symlink entries during capacity inspection", async () => {
    const { root, capsules } = await fixture();
    const value = { text: "fifo" };
    const hash = contentHash(value);
    await mkdir(capsules.rootPath, { mode: 0o700 });
    const target = path.join(capsules.rootPath, `${hash}.json`);
    await execute("mkfifo", [target]);
    await expect(capsules.read(hash)).rejects.toThrow(/file is invalid/u);
    await rm(target);
    const outside = path.join(root, "capacity-outside.json");
    await writeFile(outside, JSON.stringify(value), { mode: 0o600 });
    await symlink(outside, target);
    const next = { text: "next" };
    await expect(capsules.put(contentHash(next), JSON.stringify(next))).rejects.toThrow(/file is invalid/u);
    expect(await readFile(outside, "utf8")).toBe(JSON.stringify(value));
  }, 5_000);

  it("does not retract acknowledged capsules when independent stores race the object bound", async () => {
    const { root } = await fixture();
    const attempts = await Promise.allSettled(Array.from({ length: 16 }, async (_, index) => {
      const value = { text: `concurrent-${index % 4}` };
      const hash = contentHash(value);
      await store(root, 1).put(hash, JSON.stringify(value));
      return hash;
    }));
    const acknowledged = attempts.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    expect(acknowledged.length).toBeGreaterThan(0);
    expect(new Set(acknowledged).size).toBe(1);
    for (const hash of acknowledged) await expect(store(root, 1).read(hash)).resolves.toBeDefined();
    expect((await readdir(store(root).rootPath)).filter((name) => name.endsWith(".json"))).toHaveLength(1);
    expect((await readdir(store(root).rootPath)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("flushes the installed directory entry before a caller can publish a durable pointer", async () => {
    const { root } = await fixture();
    const script = await processFixture(root);
    const trace = path.join(root, "fs-trace.json");
    await execute(process.execPath, ["--trace-event-categories", "node.fs.async", "--trace-event-file-pattern", trace,
      script, root, "trace"], { timeout: 15_000 });
    const events = (JSON.parse(await readFile(trace, "utf8")) as { traceEvents: Array<{
      name: string; ph: string; ts: number; args?: { path?: string; result?: number };
    }> }).traceEvents;
    const install = events.findLast((event) => event.name === "link" && event.ph === "e" && event.args?.result === 0)!;
    const pointer = events.find((event) => event.name === "open" && event.ph === "b" && event.args?.path === path.join(root, "pointer.json"))!;
    expect(install).toBeDefined();
    expect(pointer).toBeDefined();
    expect(events.some((event) => event.name === "fsync" && event.ph === "e" && event.args?.result === 0 &&
      event.ts > install.ts && event.ts < pointer.ts)).toBe(true);
    expect(await readFile(path.join(root, "pointer.json"), "utf8")).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("coordinates installation and capacity across real Node processes", async () => {
    const { root } = await fixture();
    const script = await processFixture(root);
    const children = Array.from({ length: 4 }, (_, index) => fork(script, [root, String(index)], {
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    }));
    try {
      const ready = children.map((child) => new Promise<void>((resolve, reject) => {
        child.once("message", () => resolve()); child.once("error", reject);
      }));
      await Promise.all(ready);
      const results = children.map((child) => new Promise<{ ok: boolean; hash: string }>((resolve, reject) => {
        child.once("message", (value) => resolve(value as { ok: boolean; hash: string }));
        child.once("error", reject);
      }));
      for (const child of children) child.send("start");
      const outcomes = await Promise.all(results);
      const accepted = outcomes.filter((outcome) => outcome.ok);
      expect(accepted).toHaveLength(1);
      await expect(store(root, 1).read(accepted[0]!.hash)).resolves.toBeDefined();
      expect((await readdir(store(root).rootPath)).filter((name) => name.endsWith(".json"))).toHaveLength(1);
    } finally { for (const child of children) child.kill(); }
  }, 20_000);
});

async function processFixture(root: string): Promise<string> {
  const compiled = path.join(root, "compiled");
  await mkdir(compiled);
  await writeFile(path.join(compiled, "package.json"), '{"type":"module"}');
  // Run the actual checked-in implementation in isolated processes, without a dist build or mocked filesystem.
  for (const name of ["local-private-capsule-store", "workspace-write-lock"]) {
    const source = await readFile(fileURLToPath(new URL(`../src/${name}.ts`, import.meta.url)), "utf8");
    await writeFile(path.join(compiled, `${name}.js`), ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
    }).outputText);
  }
  const script = path.join(compiled, "worker.mjs");
  await writeFile(script, `import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { LocalPrivateCapsuleStore } from './local-private-capsule-store.js';
const root=process.argv[2], mode=process.argv[3];
const encode=value=>JSON.stringify({text:value.text});
const hash=value=>createHash('sha256').update(encode(value)).digest('hex');
const store=new LocalPrivateCapsuleStore({dataRoot:root,directory:'test-capsules',label:'Test',maxObjectBytes:1024,maxObjects:1,maxStorageBytes:32768,requireDurableDirectory:true,parse:JSON.parse,contentSha256:hash});
const value={text:'worker-'+mode};
if(mode==='trace'){await store.put(hash(value),encode(value));await writeFile(path.join(root,'pointer.json'),hash(value));}
else {process.send('ready');process.once('message',async()=>{try{await store.put(hash(value),encode(value));process.send({ok:true,hash:hash(value)});}catch(error){process.send({ok:false,hash:hash(value),error:String(error)});}finally{process.disconnect();}});}
`);
  return script;
}

async function capabilityFixture(fault: "flags" | "directory-open" | "directory-sync" | "file-sync", code = "ENOTSUP") {
  // Only unsupported platform capabilities are injected. The remaining filesystem operations use real files.
  if (fault === "flags") vi.doMock("node:fs", async () => {
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
    return { ...actual, constants: { ...actual.constants, O_NOFOLLOW: 0, O_DIRECTORY: 0, O_NONBLOCK: 0 } };
  });
  else vi.doMock("node:fs/promises", async () => {
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    return { ...actual, open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      const directory = (await handle.stat()).isDirectory();
      const failure = () => Object.assign(new Error(`injected ${fault}`), { code });
      if (fault === "directory-open" && directory) { await handle.close(); throw failure(); }
      if ((fault === "directory-sync" && directory) || (fault === "file-sync" && !directory))
        handle.sync = async () => { throw failure(); };
      return handle;
    } };
  });
  vi.resetModules();
  const { LocalPrivateCapsuleStore: CapabilityStore } = await import("../src/local-private-capsule-store.js");
  return (dataRoot: string, requireDurableDirectory: boolean) => new CapabilityStore<Capsule>({
    dataRoot, directory: "test-capsules", label: "Test", maxObjectBytes: 1024, maxObjects: 32,
    maxStorageBytes: 32768, requireDurableDirectory, parse: (text) => JSON.parse(text) as Capsule,
    contentSha256: contentHash,
  });
}
