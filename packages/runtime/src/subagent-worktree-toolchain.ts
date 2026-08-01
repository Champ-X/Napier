import {
  lstat,
  mkdir,
  readdir,
  readlink,
  realpath,
  symlink,
} from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "./ed25519.js";

const MAX_OVERLAY_LINKS = 512;
const MAX_OVERLAY_SCOPES = 64;

interface OverlayLink {
  linkPath: string;
  target: string;
  targetKind: "directory" | "file";
  source: "external" | "workspace";
  nameSha256: string;
  targetSha256: string;
}

export interface SubagentWorktreeToolchain {
  sourceNodeModulesRoot: string;
  candidateNodeModulesRoot: string;
  externalLinkCount: number;
  workspaceLinkCount: number;
  scopeCount: number;
  contentSha256: string;
  links: OverlayLink[];
}

export async function prepareSubagentWorktreeToolchain(input: {
  sourceRoot: string;
  candidateRoot: string;
  signal?: AbortSignal;
}): Promise<SubagentWorktreeToolchain | undefined> {
  input.signal?.throwIfAborted();
  const sourceRoot = await realpath(path.resolve(input.sourceRoot));
  const candidateRoot = await realpath(path.resolve(input.candidateRoot));
  const sourceNodeModulesRoot = path.join(sourceRoot, "node_modules");
  let observedNodeModulesRoot: string;
  try {
    observedNodeModulesRoot = await realpath(sourceNodeModulesRoot);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
  if (observedNodeModulesRoot !== sourceNodeModulesRoot) {
    throw new Error(
      "Coder verification toolchain node_modules is not canonical",
    );
  }
  const candidateNodeModulesRoot = path.join(candidateRoot, "node_modules");
  await mkdir(candidateNodeModulesRoot, { mode: 0o700 });
  const links: OverlayLink[] = [];
  let scopeCount = 0;
  const rootEntries = await sortedEntries(sourceNodeModulesRoot);
  for (const entry of rootEntries) {
    input.signal?.throwIfAborted();
    assertSafeEntryName(entry.name);
    if (entry.name.startsWith("@")) {
      if (!entry.isDirectory()) {
        throw new Error("Coder verification toolchain package scope is unsafe");
      }
      scopeCount += 1;
      if (scopeCount > MAX_OVERLAY_SCOPES) {
        throw new Error("Coder verification toolchain scope limit exceeded");
      }
      const sourceScope = path.join(sourceNodeModulesRoot, entry.name);
      const candidateScope = path.join(candidateNodeModulesRoot, entry.name);
      await mkdir(candidateScope, { mode: 0o700 });
      for (const child of await sortedEntries(sourceScope)) {
        input.signal?.throwIfAborted();
        assertSafeEntryName(child.name);
        await createOverlayLink({
          sourceRoot,
          sourceNodeModulesRoot,
          candidateRoot,
          sourcePath: path.join(sourceScope, child.name),
          candidatePath: path.join(candidateScope, child.name),
          displayName: `${entry.name}/${child.name}`,
          links,
        });
      }
      continue;
    }
    await createOverlayLink({
      sourceRoot,
      sourceNodeModulesRoot,
      candidateRoot,
      sourcePath: path.join(sourceNodeModulesRoot, entry.name),
      candidatePath: path.join(candidateNodeModulesRoot, entry.name),
      displayName: entry.name,
      links,
    });
  }
  const receipt = links.map(
    ({ linkPath: _linkPath, target: _target, ...link }) => link,
  );
  return {
    sourceNodeModulesRoot,
    candidateNodeModulesRoot,
    externalLinkCount: links.filter((link) => link.source === "external")
      .length,
    workspaceLinkCount: links.filter((link) => link.source === "workspace")
      .length,
    scopeCount,
    contentSha256: sha256(canonicalJson(receipt)),
    links,
  };
}

export async function assertSubagentWorktreeToolchainStable(
  toolchain: SubagentWorktreeToolchain,
): Promise<void> {
  const [sourceRootInfo, candidateRootInfo] = await Promise.all([
    lstat(toolchain.sourceNodeModulesRoot),
    lstat(toolchain.candidateNodeModulesRoot),
  ]);
  if (
    !sourceRootInfo.isDirectory() ||
    sourceRootInfo.isSymbolicLink() ||
    !candidateRootInfo.isDirectory() ||
    candidateRootInfo.isSymbolicLink() ||
    (await realpath(toolchain.sourceNodeModulesRoot)) !==
      toolchain.sourceNodeModulesRoot ||
    (await realpath(toolchain.candidateNodeModulesRoot)) !==
      toolchain.candidateNodeModulesRoot
  ) {
    throw new Error("Coder verification toolchain root changed");
  }
  for (const link of toolchain.links) {
    const info = await lstat(link.linkPath);
    if (!info.isSymbolicLink()) {
      throw new Error("Coder verification toolchain overlay changed");
    }
    await readlink(link.linkPath);
    if ((await realpath(link.linkPath)) !== link.target) {
      throw new Error("Coder verification toolchain overlay target changed");
    }
    const targetInfo = await lstat(link.target);
    if (
      targetInfo.isSymbolicLink() ||
      (link.targetKind === "directory"
        ? !targetInfo.isDirectory()
        : !targetInfo.isFile())
    ) {
      throw new Error("Coder verification toolchain overlay target changed");
    }
  }
}

async function createOverlayLink(input: {
  sourceRoot: string;
  sourceNodeModulesRoot: string;
  candidateRoot: string;
  sourcePath: string;
  candidatePath: string;
  displayName: string;
  links: OverlayLink[];
}): Promise<void> {
  if (input.links.length >= MAX_OVERLAY_LINKS) {
    throw new Error("Coder verification toolchain link limit exceeded");
  }
  const sourceInfo = await lstat(input.sourcePath);
  if (
    !sourceInfo.isDirectory() &&
    !sourceInfo.isFile() &&
    !sourceInfo.isSymbolicLink()
  ) {
    throw new Error("Coder verification toolchain contains a special entry");
  }
  const resolved = await realpath(input.sourcePath);
  let target = resolved;
  let source: OverlayLink["source"] = "external";
  if (
    isPathInside(resolved, input.sourceRoot) &&
    !isPathInside(resolved, input.sourceNodeModulesRoot)
  ) {
    const relative = path.relative(input.sourceRoot, resolved);
    target = path.resolve(input.candidateRoot, relative);
    if (
      !isPathInside(target, input.candidateRoot) ||
      (await realpath(target)) !== target
    ) {
      throw new Error(
        "Coder verification workspace package is unavailable in the candidate",
      );
    }
    source = "workspace";
  } else if (!isPathInside(resolved, input.sourceNodeModulesRoot)) {
    throw new Error(
      "Coder verification toolchain dependency escapes node_modules",
    );
  }
  const targetInfo = await lstat(target);
  const targetKind = targetInfo.isDirectory()
    ? "directory"
    : targetInfo.isFile()
      ? "file"
      : undefined;
  if (!targetKind || targetInfo.isSymbolicLink()) {
    throw new Error("Coder verification toolchain target is unsafe");
  }
  await symlink(
    target,
    input.candidatePath,
    targetKind === "directory" ? "dir" : "file",
  );
  input.links.push({
    linkPath: input.candidatePath,
    target,
    targetKind,
    source,
    nameSha256: sha256(input.displayName),
    targetSha256: sha256(
      source === "workspace"
        ? path.relative(input.candidateRoot, target).split(path.sep).join("/")
        : path
            .relative(input.sourceNodeModulesRoot, target)
            .split(path.sep)
            .join("/"),
    ),
  });
}

async function sortedEntries(directory: string) {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries.sort((left, right) => left.name.localeCompare(right.name));
}

function assertSafeEntryName(value: string): void {
  if (
    !value ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error("Coder verification toolchain entry name is unsafe");
  }
}

function isPathInside(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error
    ? String((error as NodeJS.ErrnoException).code)
    : undefined;
}
