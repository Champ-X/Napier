import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const ROOT = path.resolve(import.meta.dirname, "..");
const execFileAsync = promisify(execFile);
const OUTPUT_PATH = "docs/artifacts/default-product-source-manifest-0.1.3.json";
const IDENTITY_PATH = "packages/runtime/src/release-product-identity.ts";
const DIRECTORIES = [
  "apps/server/src",
  "apps/web/src",
  "packages/contracts/src",
  "packages/runtime/src",
  "skills",
];
const FILES = [
  "apps/server/package.json",
  "apps/server/tsconfig.json",
  "apps/web/index.html",
  "apps/web/package.json",
  "apps/web/tsconfig.json",
  "apps/web/vite.config.ts",
  "docker/napier-sandbox/Dockerfile",
  "docker/napier-sandbox/package-lock.json",
  "docker/napier-sandbox/package.json",
  "package-lock.json",
  "package.json",
  "packages/contracts/package.json",
  "packages/contracts/tsconfig.json",
  "packages/runtime/package.json",
  "packages/runtime/tsconfig.json",
  "scripts/copy-sandbox-image.mjs",
  "scripts/release-product-source-manifest.mjs",
  "tsconfig.base.json",
];
const IDENTITY_PATTERN =
  /^export const NAPIER_PRODUCT_VERSION = "([^"]+)";\nexport const NAPIER_RELEASE_IDENTITY_SHA256 =\n  "(RELEASE_IDENTITY_SHA256_PLACEHOLDER|[a-f0-9]{64})";\n$/u;
const PREDECESSOR = {
  productVersion: "0.1.2",
  commit: "45c736f0b426db5d03f88adbb17acb8df32e7703",
};

export async function createReleaseProductSourceManifest() {
  const identity = await readIdentity();
  const paths = [
    ...FILES,
    ...(await Promise.all(DIRECTORIES.map(listFiles))).flat(),
  ]
    .filter((file) => file !== IDENTITY_PATH && !file.endsWith("/.DS_Store"))
    .sort();
  assert.equal(
    new Set(paths).size,
    paths.length,
    "Source paths must be unique",
  );
  const [files, predecessorChangedPaths] = await Promise.all([
    Promise.all(paths.map(sourceRecord)),
    changedPathsFromPredecessor(paths),
  ]);
  assert.ok(
    predecessorChangedPaths.length > 0,
    "A new product version requires material source changes",
  );
  const evidence = {
    kind: "napier.release-product-source-manifest",
    schemaVersion: 1,
    productVersion: identity.productVersion,
    predecessor: {
      ...PREDECESSOR,
      changedPathCount: predecessorChangedPaths.length,
      changedPathsSha256: sha256(canonicalJson(predecessorChangedPaths)),
    },
    identityDeclarationPath: IDENTITY_PATH,
    identityDeclarationSha256: identity.declarationSha256,
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    files,
  };
  return { ...evidence, contentSha256: sha256(canonicalJson(evidence)) };
}

export async function verifyReleaseProductSourceManifest(file = OUTPUT_PATH) {
  const expected = await createReleaseProductSourceManifest();
  const observed = JSON.parse(await readFile(path.resolve(ROOT, file), "utf8"));
  assert.deepEqual(observed, expected);
  const identity = await readIdentity();
  assert.equal(identity.releaseIdentitySha256, expected.contentSha256);
  return expected;
}

async function readIdentity() {
  const text = await readFile(path.resolve(ROOT, IDENTITY_PATH), "utf8");
  const match = text.match(IDENTITY_PATTERN);
  assert.ok(match, "Release Product identity declaration is invalid");
  return {
    productVersion: match[1],
    releaseIdentitySha256: match[2],
    declarationSha256: sha256(
      text.replace(match[2], "RELEASE_IDENTITY_SHA256_PLACEHOLDER"),
    ),
  };
}

async function listFiles(relativeDirectory) {
  const output = [];
  const entries = await readdir(path.resolve(ROOT, relativeDirectory), {
    withFileTypes: true,
  });
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const relative = path.posix.join(relativeDirectory, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(
        `Release Product source cannot be a symlink: ${relative}`,
      );
    if (entry.isDirectory()) output.push(...(await listFiles(relative)));
    else if (entry.isFile()) output.push(relative);
  }
  return output;
}

async function sourceRecord(relativePath) {
  const target = path.resolve(ROOT, relativePath);
  const info = await lstat(target);
  assert.equal(
    info.isFile(),
    true,
    `Release Product source is not a file: ${relativePath}`,
  );
  assert.equal(
    info.isSymbolicLink(),
    false,
    `Release Product source is a symlink: ${relativePath}`,
  );
  const bytes = await readFile(target);
  return { path: relativePath, bytes: bytes.length, sha256: sha256(bytes) };
}

async function changedPathsFromPredecessor(currentPaths) {
  const scope = [...DIRECTORIES, ...FILES, IDENTITY_PATH];
  const [{ stdout: diffOutput }, { stdout: treeOutput }] = await Promise.all([
    execFileAsync(
      "git",
      [
        "diff",
        "--name-only",
        "--diff-filter=ACDMRTUXB",
        PREDECESSOR.commit,
        "--",
        ...scope,
      ],
      { cwd: ROOT, maxBuffer: 1024 * 1024 },
    ),
    execFileAsync(
      "git",
      ["ls-tree", "-r", "--name-only", PREDECESSOR.commit, "--", ...scope],
      { cwd: ROOT, maxBuffer: 1024 * 1024 },
    ),
  ]);
  const predecessorPaths = new Set(lines(treeOutput));
  const changed = new Set(lines(diffOutput));
  for (const current of currentPaths) {
    if (!predecessorPaths.has(current)) changed.add(current);
  }
  const currentSet = new Set(currentPaths);
  for (const previous of predecessorPaths) {
    if (!currentSet.has(previous)) changed.add(previous);
  }
  changed.delete(IDENTITY_PATH);
  return [...changed].sort();
}

function lines(value) {
  return value.split("\n").filter(Boolean);
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function main() {
  const write = process.argv.includes("--write");
  const manifest = await createReleaseProductSourceManifest();
  if (write) {
    await writeFile(
      path.resolve(ROOT, OUTPUT_PATH),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
  } else {
    await verifyReleaseProductSourceManifest();
  }
  process.stdout.write(`${manifest.contentSha256} ${OUTPUT_PATH}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main();
}
