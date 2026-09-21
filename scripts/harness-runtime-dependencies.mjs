import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const packageName = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/iu;

/** Resolve the installed Node package tree from the actual entry package.
 * Workspace links are followed at package boundaries, never assumed to point
 * into the advertised Runtime snapshot. Dev dependencies are not execution inputs.
 * This inventories package bytes; it is not a claim to capture OS libraries,
 * credentials, dynamically downloaded code or browser/OCI images. */
export async function scanRuntimeDependencies(
  runtimeRoot,
  execution = process,
) {
  const options = {
    execArgv: execution.execArgv,
    nodeOptions: execution.env.NODE_OPTIONS ?? "",
    nodePath: execution.env.NODE_PATH ?? "",
  };
  if (
    options.nodePath ||
    /(?:^|\s)(?:--preserve-symlinks(?:-main)?|--require|--import|--(?:experimental-)?loader|-r)(?:=|\s|$)/u.test(
      [...options.execArgv, options.nodeOptions].join(" "),
    )
  )
    throw new Error(
      "Custom Node loaders, preloads and package resolution are not inventoried",
    );
  const packages = new Map(),
    locations = new Map(),
    blockers = [];
  let fileCount = 0,
    byteCount = 0;
  async function filesAt(root, relative = "", ancestors = new Set()) {
    const directory = path.join(root, relative);
    const actual = await realpath(directory);
    if (ancestors.has(actual)) throw new Error("Package directory link cycle");
    const nextAncestors = new Set([...ancestors, actual]);
    const files = [];
    for (const item of (await readdir(directory, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      if (item.name === "node_modules" || item.name === ".git") continue;
      const name = path.join(relative, item.name),
        entry = path.join(root, name);
      const resolved = await realpath(entry);
      if (resolved !== root && !resolved.startsWith(root + path.sep))
        throw new Error(`Package contains an external internal link: ${name}`);
      const info = await stat(entry);
      if (info.isDirectory())
        files.push(...(await filesAt(root, name, nextAncestors)));
      else if (info.isFile()) {
        if (
          ++fileCount > 100000 ||
          (byteCount += info.size) > 1024 * 1024 * 1024
        )
          throw new Error("Runtime dependency inventory limit exceeded");
        const bytes = await readFile(entry);
        const after = await stat(entry);
        if (
          bytes.length !== info.size ||
          info.size !== after.size ||
          info.mtimeMs !== after.mtimeMs ||
          info.ino !== after.ino
        )
          throw new Error("Package file changed during inventory");
        files.push({
          path: name,
          bytes: bytes.length,
          executable: info.mode & 0o111,
          sha256: hash(bytes),
          ...(item.isSymbolicLink()
            ? { linkTarget: path.relative(root, resolved) }
            : {}),
        });
      } else throw new Error(`Package special file is unsupported: ${name}`);
    }
    return files;
  }
  async function resolveInstalled(from, name) {
    if (
      !packageName.test(name) ||
      name.split("/").some((part) => part === "." || part === "..")
    )
      throw new Error("Invalid dependency package name");
    for (let directory = from; ; directory = path.dirname(directory)) {
      const candidate = path.join(directory, "node_modules", name);
      try {
        await lstat(candidate);
        return await realpath(candidate);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      if (path.dirname(directory) === directory) return undefined;
    }
  }
  async function visit(directory) {
    const root = await realpath(directory),
      id = hash(root);
    if (packages.has(id)) return id;
    if (packages.size >= 512)
      throw new Error("Runtime dependency package limit exceeded");
    const manifestBytes = await readFile(path.join(root, "package.json"));
    const manifest = JSON.parse(manifestBytes);
    const item = {
      id,
      name: manifest.name ?? null,
      version: manifest.version ?? null,
      manifestSha256: hash(manifestBytes),
      files: [],
      dependencies: [],
    };
    packages.set(id, item);
    locations.set(id, root);
    item.files = await filesAt(root);
    if (
      item.files.find((f) => f.path === "package.json")?.sha256 !==
      item.manifestSha256
    )
      throw new Error("Package manifest changed during inventory");
    const names = [
      ...new Set([
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.optionalDependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}),
      ]),
    ].sort();
    for (const name of names) {
      const optional =
        Object.hasOwn(manifest.optionalDependencies ?? {}, name) ||
        (!Object.hasOwn(manifest.dependencies ?? {}, name) &&
          manifest.peerDependenciesMeta?.[name]?.optional === true);
      const resolved = await resolveInstalled(root, name);
      const dependency = {
        name,
        spec:
          manifest.optionalDependencies?.[name] ??
          manifest.dependencies?.[name] ??
          manifest.peerDependencies[name],
        optional,
        packageId: resolved ? await visit(resolved) : null,
      };
      item.dependencies.push(dependency);
      if (!resolved && !optional)
        blockers.push(`${item.name}: missing required package ${name}`);
    }
    item.contentSha256 = hash(
      JSON.stringify({
        manifestSha256: item.manifestSha256,
        files: item.files,
      }),
    );
    return id;
  }
  const entryPackageId = await visit(
    path.join(runtimeRoot, "packages/runtime"),
  );
  const content = {
    kind: "napier.runtime-dependency-graph",
    schemaVersion: 1,
    entryPackageId,
    scope:
      "installed production/optional/peer package bytes; excludes dev dependencies, nested node_modules and .git",
    executionOptionsSha256: hash(JSON.stringify(options)),
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    packages: [...packages.values()].sort((a, b) => a.id.localeCompare(b.id)),
    fileCount,
    byteCount,
    blockers,
    eligible: blockers.length === 0,
  };
  return {
    ...content,
    contentSha256: hash(JSON.stringify(content)),
    locations: Object.fromEntries(locations),
  };
}

export function dependencyGraphReceipt(graph, after = graph, runId = null) {
  const content = {
    kind: "napier.runtime-dependency-evidence",
    schemaVersion: 1,
    runId,
    beforeSha256: graph.contentSha256,
    afterSha256: after.contentSha256,
    packageCount: graph.packages.length,
    fileCount: graph.fileCount,
    stable: graph.contentSha256 === after.contentSha256,
    eligible:
      graph.eligible &&
      after.eligible &&
      graph.contentSha256 === after.contentSha256,
  };
  return { ...content, contentSha256: hash(JSON.stringify(content)) };
}

export function dependencyEvidenceEligible(report) {
  const receipt = report.runtimeDependencyEvidence;
  if (!receipt || typeof receipt !== "object") return false;
  const { contentSha256, ...content } = receipt;
  return (
    contentSha256 === hash(JSON.stringify(content)) &&
    content.kind === "napier.runtime-dependency-evidence" &&
    content.schemaVersion === 1 &&
    content.runId === report.runId &&
    typeof content.runId === "string" &&
    /^[a-f0-9]{64}$/u.test(content.beforeSha256) &&
    content.beforeSha256 === content.afterSha256 &&
    Number.isSafeInteger(content.packageCount) &&
    content.packageCount > 0 &&
    Number.isSafeInteger(content.fileCount) &&
    content.fileCount >= content.packageCount &&
    content.stable === true &&
    content.eligible === true
  );
}
