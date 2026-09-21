import { constants } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import path from "node:path";
import { canonicalJson, sha256 } from "./ed25519.js";

export const RUN_INPUT_LIMITS = Object.freeze({
  files: 2000,
  bytes: 16 * 1024 * 1024,
  milliseconds: 2000,
});
export interface RunInputFile {
  path: string;
  mode: number;
  sha256: string;
  data: string;
}
export interface RunInputOmission {
  pathSha256: string;
  reason: string;
}
export interface RunInputWorkspace {
  files: RunInputFile[];
  directories: Array<{ path: string; mode: number }>;
  omissions: RunInputOmission[];
  bytes: number;
}

const excluded = new Set([
  ".git",
  ".napier",
  "node_modules",
  ".venv",
  "venv",
  "__pycache__",
  ".ssh",
  ".aws",
  ".azure",
  ".config",
  ".npmrc",
  ".pypirc",
  ".netrc",
  "credentials.json",
  ".git-credentials",
  "id_rsa",
  "id_ed25519",
]);
export function excludedRunInputPath(relative: string): boolean {
  return relative
    .split("/")
    .some(
      (part) =>
        excluded.has(part.toLowerCase()) ||
        /^\.env/iu.test(part) ||
        /\.(?:pem|key|p12|pfx|jks)$/iu.test(part),
    );
}
export function validRunInputPath(relative: unknown): relative is string {
  return (
    typeof relative === "string" &&
    relative.length > 0 &&
    relative.length <= 4096 &&
    !/[\\\u0000-\u001f:]/u.test(relative) &&
    !path.posix.isAbsolute(relative) &&
    relative
      .split("/")
      .every((part) => part !== "" && part !== "." && part !== "..")
  );
}

/** Bounded, optimistic file capture. A second complete scan detects observed
 * drift; this is not an atomic filesystem snapshot or an external-service image. */
export async function captureRunInputWorkspace(input: {
  workspaceRoot: string;
  dataRoot: string;
  signal?: AbortSignal;
}): Promise<RunInputWorkspace> {
  const root = await realpath(input.workspaceRoot);
  const dataRoot = await realpath(input.dataRoot);
  if (root === dataRoot) throw new Error("capture_data_root_is_workspace");
  const deadline = Date.now() + RUN_INPUT_LIMITS.milliseconds;
  const check = () => {
    input.signal?.throwIfAborted();
    if (Date.now() >= deadline) throw new Error("capture_deadline");
  };
  const first = await scan(root, dataRoot, check);
  if (first.omissions.some((item) => item.reason !== "excluded")) return first;
  const second = await scan(root, dataRoot, check);
  if (sha256(canonicalJson(first)) !== sha256(canonicalJson(second))) {
    first.omissions.push({
      pathSha256: sha256("."),
      reason: "workspace_changed_during_capture",
    });
  }
  return first;
}

async function scan(
  root: string,
  dataRoot: string,
  check: () => void,
): Promise<RunInputWorkspace> {
  const result: RunInputWorkspace = {
    files: [],
    directories: [],
    omissions: [],
    bytes: 0,
  };
  let visited = 0;
  const omit = (relative: string, reason: string) =>
    result.omissions.push({ pathSha256: sha256(relative), reason });
  const visit = async (directory: string): Promise<void> => {
    check();
    const dir = await opendir(directory);
    for await (const entry of dir) {
      check();
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (++visited > RUN_INPUT_LIMITS.files) {
        omit(relative, "entry_limit");
        return;
      }
      if (
        !validRunInputPath(relative) ||
        excludedRunInputPath(relative) ||
        absolute === dataRoot
      ) {
        omit(relative, "excluded");
        continue;
      }
      const info = await lstat(absolute);
      if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) {
        omit(relative, "unsupported_entry");
        continue;
      }
      if ((await realpath(absolute)) !== absolute) {
        omit(relative, "path_changed");
        continue;
      }
      if (info.isDirectory()) {
        result.directories.push({ path: relative, mode: info.mode & 0o777 });
        await visit(absolute);
        if (visited > RUN_INPUT_LIMITS.files) return;
      } else {
        if (info.size > RUN_INPUT_LIMITS.bytes - result.bytes) {
          omit(relative, "byte_limit");
          continue;
        }
        const handle = await open(
          absolute,
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
        try {
          const before = await handle.stat();
          if (
            !before.isFile() ||
            before.dev !== info.dev ||
            before.ino !== info.ino ||
            before.size !== info.size ||
            before.mtimeMs !== info.mtimeMs
          ) {
            omit(relative, "file_changed");
            continue;
          }
          const buffer = Buffer.alloc(info.size + 1);
          let length = 0;
          while (length < buffer.length) {
            check();
            const read = await handle.read(
              buffer,
              length,
              buffer.length - length,
              length,
            );
            if (read.bytesRead === 0) break;
            length += read.bytesRead;
          }
          const after = await handle.stat();
          if (
            length !== info.size ||
            after.size !== before.size ||
            after.mtimeMs !== before.mtimeMs ||
            after.ctimeMs !== before.ctimeMs ||
            (await realpath(absolute)) !== absolute
          ) {
            omit(relative, "file_changed");
            continue;
          }
          const data = buffer.subarray(0, length);
          result.files.push({
            path: relative,
            mode: before.mode & 0o777,
            sha256: sha256(data),
            data: data.toString("base64"),
          });
          result.bytes += length;
        } finally {
          await handle.close();
        }
      }
    }
  };
  await visit(root);
  result.files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  result.directories.sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  result.omissions.sort((a, b) => a.pathSha256.localeCompare(b.pathSha256));
  return result;
}
