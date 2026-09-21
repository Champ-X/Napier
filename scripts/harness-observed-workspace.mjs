import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const MAX_FILES = 2000,
  MAX_BYTES = 16 * 1024 * 1024;
const GRADER = "__napier_external_grader__.mjs";
function validPath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !path.isAbsolute(value) &&
    !path.win32.isAbsolute(value) &&
    !value.includes("\0") &&
    !value.includes("\\") &&
    value
      .split("/")
      .every((part) => part !== "" && part !== "." && part !== "..")
  );
}
function normalizedFiles(files) {
  if (!files || typeof files !== "object" || Array.isArray(files))
    throw new Error("Invalid observed file map");
  const entries = Object.entries(files);
  if (
    entries.some(
      ([key, value]) =>
        !validPath(key) ||
        typeof value !== "string" ||
        !/^[a-f0-9]{64}$/.test(value),
    )
  )
    throw new Error("Invalid observed file entry");
  return Object.fromEntries(
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}
export function createObservedWorkspaceReceipt(runId, files) {
  if (typeof runId !== "string" || !runId.length)
    throw new Error("Missing observed Run ID");
  const content = {
    kind: "napier.harness-observed-workspace",
    schemaVersion: 1,
    runId,
    files: normalizedFiles(files),
  };
  return { ...content, contentSha256: digest(JSON.stringify(content)) };
}
export function validateObservedWorkspaceReceipt(receipt, runId) {
  if (
    !receipt ||
    Object.keys(receipt).sort().join() !==
      "contentSha256,files,kind,runId,schemaVersion" ||
    receipt.kind !== "napier.harness-observed-workspace" ||
    receipt.schemaVersion !== 1 ||
    receipt.runId !== runId ||
    createObservedWorkspaceReceipt(runId, receipt.files).contentSha256 !==
      receipt.contentSha256
  )
    throw new Error(
      "Observed workspace receipt is missing, changed or foreign",
    );
  return createObservedWorkspaceReceipt(runId, receipt.files);
}
async function listFiles(root, prefix = "", budget = { entries: 0 }) {
  const files = [];
  for (const entry of await readdir(path.join(root, prefix), {
    withFileTypes: true,
  })) {
    const relative = prefix ? prefix + "/" + entry.name : entry.name;
    if (!prefix && entry.name === GRADER) continue;
    if (++budget.entries > MAX_FILES)
      throw new Error("Observed workspace entry limit exceeded");
    if (entry.isDirectory())
      files.push(...(await listFiles(root, relative, budget)));
    else if (entry.isFile()) files.push(relative);
    else
      throw new Error(
        "Observed workspace links or special entries are unsupported",
      );
    if (files.length > MAX_FILES)
      throw new Error("Observed workspace file limit exceeded");
  }
  return files.sort();
}
/** Export only bytes bound at settlement, never substitute final state for the
 * original fixture. The later external grader is outside this snapshot. */
export async function copyObservedWorkspace({ root, output, receipt, runId }) {
  const bound = validateObservedWorkspaceReceipt(receipt, runId),
    files = Object.keys(bound.files).sort();
  if (files.length > MAX_FILES)
    throw new Error("Observed workspace file limit exceeded");
  if (files.includes(GRADER))
    throw new Error("Observed receipt includes the later grader");
  if (
    files.some((file) =>
      file
        .split("/")
        .some((part) =>
          /^(?:\.env(?:\..*)?|\.git|\.napier|node_modules|.*\.(?:pem|key))$/i.test(
            part,
          ),
        ),
    )
  )
    throw new Error(
      "Observed workspace contains an excluded private/runtime path",
    );
  const source = await realpath(root);
  if (!(await lstat(source)).isDirectory())
    throw new Error("Observed workspace must be a directory");
  if (JSON.stringify(await listFiles(source)) !== JSON.stringify(files))
    throw new Error("Observed workspace file set changed");
  await mkdir(output, { mode: 0o700 });
  let total = 0;
  for (const relative of files) {
    const target = path.join(source, relative);
    if ((await realpath(target)) !== target)
      throw new Error("Observed workspace ancestor link is unsupported");
    const handle = await open(
      target,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    let bytes;
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_BYTES - total)
        throw new Error("Observed workspace byte limit or file kind rejected");
      const buffer = Buffer.alloc(stat.size + 1);
      let used = 0;
      while (used < buffer.length) {
        const read = await handle.read(
          buffer,
          used,
          buffer.length - used,
          used,
        );
        if (!read.bytesRead) break;
        used += read.bytesRead;
      }
      const after = await handle.stat(),
        current = await lstat(target);
      if (
        used !== stat.size ||
        after.size !== stat.size ||
        current.dev !== stat.dev ||
        current.ino !== stat.ino ||
        !current.isFile()
      )
        throw new Error("Observed file changed during capture");
      bytes = buffer.subarray(0, used);
      if (digest(bytes) !== bound.files[relative])
        throw new Error("Observed file bytes changed");
    } finally {
      await handle.close();
    }
    total += bytes.length;
    const destination = path.join(output, relative);
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, bytes, { flag: "wx", mode: 0o600 });
  }
  if (JSON.stringify(await listFiles(source)) !== JSON.stringify(files))
    throw new Error("Observed workspace changed during export");
  return {
    receipt: bound,
    fileCount: files.length,
    bytes: total,
    scope:
      "File bytes only; modes, dependencies and external services are not restored",
  };
}
