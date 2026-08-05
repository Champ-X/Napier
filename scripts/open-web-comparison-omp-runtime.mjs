import { execFile } from "node:child_process";
import {
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { sha256 } from "../packages/runtime/dist/index.js";

const execFileAsync = promisify(execFile);
const OMP_PACKAGE_NAME = "@oh-my-pi/pi-coding-agent";

export async function createOpenWebComparisonOmpRuntime(input) {
  const installedEntry = await realpath(input.installedEntry);
  const packageRoot = path.dirname(path.dirname(installedEntry));
  const sourceNodeModules = path.resolve(packageRoot, "../..");
  const runtimeRoot = path.join(input.temporaryRoot, "omp-runtime-image");
  const targetNodeModules = path.join(runtimeRoot, "node_modules");
  await mkdir(runtimeRoot, { recursive: false, mode: 0o700 });
  await mkdir(targetNodeModules, { recursive: false, mode: 0o700 });
  await copyPackageClosure(
    sourceNodeModules,
    targetNodeModules,
    OMP_PACKAGE_NAME,
  );
  const entry = path.join(
    targetNodeModules,
    "@oh-my-pi/pi-coding-agent/dist/cli.js",
  );
  const [sourceBytes, targetBytes, targetInfo] = await Promise.all([
    readFile(installedEntry),
    readFile(entry),
    lstat(entry),
  ]);
  if (
    !targetInfo.isFile() ||
    targetInfo.isSymbolicLink() ||
    sha256(sourceBytes) !== sha256(targetBytes)
  ) {
    throw new Error("OMP comparison runtime image binding failed");
  }
  const canonicalRuntimeRoot = await realpath(runtimeRoot);
  await assertRuntimeSymlinksBounded(
    canonicalRuntimeRoot,
    canonicalRuntimeRoot,
  );
  return {
    root: canonicalRuntimeRoot,
    entry,
    executableSha256: sha256(targetBytes),
    packageVersion: await packageVersion(
      path.join(targetNodeModules, "@oh-my-pi/pi-coding-agent/package.json"),
    ),
  };
}

async function copyPackageClosure(sourceNodeModules, targetNodeModules, root) {
  const copied = new Set();
  const visit = async (packageName, optional = false) => {
    validatePackageName(packageName);
    if (copied.has(packageName)) return;
    const sourceRoot = packagePath(sourceNodeModules, packageName);
    const manifestPath = path.join(sourceRoot, "package.json");
    if (!(await available(manifestPath))) {
      if (optional) return;
      throw new Error(`OMP runtime dependency is unavailable: ${packageName}`);
    }
    const sourceInfo = await lstat(sourceRoot);
    if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) {
      throw new Error(
        `OMP runtime dependency is not a directory: ${packageName}`,
      );
    }
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (!manifest || manifest.name !== packageName) {
      throw new Error(
        `OMP runtime dependency manifest is invalid: ${packageName}`,
      );
    }
    copied.add(packageName);
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      await visit(dependency);
    }
    for (const dependency of Object.keys(manifest.optionalDependencies ?? {})) {
      await visit(dependency, true);
    }
    for (const dependency of Object.keys(manifest.peerDependencies ?? {})) {
      await visit(dependency, true);
    }
    const targetRoot = packagePath(targetNodeModules, packageName);
    await mkdir(path.dirname(targetRoot), { recursive: true, mode: 0o700 });
    await execFileAsync("/bin/cp", ["-cR", sourceRoot, targetRoot]);
  };
  await visit(root);
}

async function assertRuntimeSymlinksBounded(runtimeRoot, directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      const canonicalTarget = await realpath(target);
      const relative = path.relative(runtimeRoot, canonicalTarget);
      if (
        relative.startsWith(`..${path.sep}`) ||
        relative === ".." ||
        path.isAbsolute(relative)
      ) {
        throw new Error("OMP comparison runtime symlink escapes its image");
      }
      continue;
    }
    if (entry.isDirectory()) {
      await assertRuntimeSymlinksBounded(runtimeRoot, target);
    }
  }
}

function packagePath(nodeModules, packageName) {
  return path.join(nodeModules, ...packageName.split("/"));
}

function validatePackageName(value) {
  if (
    typeof value !== "string" ||
    !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/iu.test(value)
  ) {
    throw new Error("OMP runtime dependency name is invalid");
  }
}

async function available(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function packageVersion(packagePath) {
  const parsed = JSON.parse(await readFile(packagePath, "utf8"));
  if (
    !parsed ||
    typeof parsed !== "object" ||
    parsed.name !== OMP_PACKAGE_NAME ||
    typeof parsed.version !== "string" ||
    !/^[0-9]+\.[0-9]+\.[0-9]+$/u.test(parsed.version)
  ) {
    throw new Error("OMP comparison runtime package is invalid");
  }
  return parsed.version;
}
