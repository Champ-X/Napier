import { constants } from "node:fs";
import { access, chmod, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function prepareNodePty(
  packageRoot,
  platform = process.platform,
  arch = process.arch,
) {
  if (platform !== "darwin" && platform !== "linux") return;
  const candidates = [
    path.join(packageRoot, "build", "Release", "spawn-helper"),
    path.join(packageRoot, "prebuilds", `${platform}-${arch}`, "spawn-helper"),
  ];
  let prepared = false;
  for (const candidate of candidates) {
    const metadata = await lstat(candidate).catch(() => undefined);
    if (!metadata) continue;
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error("node-pty spawn helper must be a regular file");
    }
    await chmod(candidate, metadata.mode | 0o100);
    await access(candidate, constants.X_OK);
    prepared = true;
  }
  if (!prepared) {
    throw new Error(
      `node-pty spawn helper is unavailable for ${platform}/${arch}`,
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  await prepareNodePty(path.join(repoRoot, "node_modules", "node-pty"));
}
