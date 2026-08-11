import { constants } from "node:fs";
import { access, chmod, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function prepareNodePty(
  nodeModulesRoot,
  platform = process.platform,
  arch = process.arch,
) {
  if (!["darwin", "linux", "win32"].includes(platform)) return;
  const packageRoot = path.join(
    nodeModulesRoot,
    "@lydell",
    `node-pty-${platform}-${arch}`,
  );
  const binary = path.join(
    packageRoot,
    "prebuilds",
    `${platform}-${arch}`,
    platform === "win32" ? "conpty.node" : "pty.node",
  );
  await assertRegularFile(binary, "node-pty native binary");
  if (platform === "darwin") {
    const helper = path.join(
      packageRoot,
      "prebuilds",
      `${platform}-${arch}`,
      "spawn-helper",
    );
    const metadata = await assertRegularFile(helper, "node-pty spawn helper");
    await chmod(helper, metadata.mode | 0o100);
    await access(helper, constants.X_OK);
  }
}

async function assertRegularFile(filePath, label) {
  const metadata = await lstat(filePath).catch(() => undefined);
  if (!metadata) throw new Error(`${label} is unavailable`);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file`);
  }
  return metadata;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  await prepareNodePty(path.join(repoRoot, "node_modules"));
}
