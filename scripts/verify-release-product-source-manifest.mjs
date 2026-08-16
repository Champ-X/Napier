import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

const SHA256 = /^[a-f0-9]{64}$/u;

export async function verifyReleaseProductSourceManifestArtifact(file) {
  const target = path.resolve(file);
  const info = await lstat(target);
  assert.equal(info.isFile(), true);
  assert.equal(info.isSymbolicLink(), false);
  assert.equal(info.size <= 512 * 1024, true);
  const artifact = JSON.parse(await readFile(target, "utf8"));
  assert.deepEqual(Object.keys(artifact).sort(), [
    "contentSha256",
    "fileCount",
    "files",
    "identityDeclarationPath",
    "identityDeclarationSha256",
    "kind",
    "predecessor",
    "productVersion",
    "schemaVersion",
    "totalBytes",
  ]);
  assert.equal(artifact.kind, "napier.release-product-source-manifest");
  assert.equal(artifact.schemaVersion, 1);
  assert.equal(artifact.productVersion, "0.1.3");
  assert.equal(
    artifact.identityDeclarationPath,
    "packages/runtime/src/release-product-identity.ts",
  );
  assert.match(artifact.identityDeclarationSha256, SHA256);
  assert.equal(Array.isArray(artifact.files), true);
  assert.equal(artifact.fileCount, artifact.files.length);
  assert.equal(
    artifact.totalBytes,
    artifact.files.reduce((sum, item) => sum + item.bytes, 0),
  );
  const sortedPaths = artifact.files.map((item) => item.path).sort();
  assert.equal(
    artifact.files.every(
      (item, index) =>
        item &&
        typeof item.path === "string" &&
        item.path.length > 0 &&
        item.path === sortedPaths[index] &&
        Number.isSafeInteger(item.bytes) &&
        item.bytes >= 0 &&
        SHA256.test(item.sha256) &&
        item.path !== "goal.md" &&
        !item.path.startsWith("ai-news-weekly/") &&
        !item.path.startsWith("kakeya/"),
    ),
    true,
  );
  assert.deepEqual(artifact.predecessor, {
    productVersion: "0.1.2",
    commit: "45c736f0b426db5d03f88adbb17acb8df32e7703",
    changedPathCount: artifact.predecessor.changedPathCount,
    changedPathsSha256: artifact.predecessor.changedPathsSha256,
  });
  assert.equal(artifact.predecessor.changedPathCount > 0, true);
  assert.match(artifact.predecessor.changedPathsSha256, SHA256);
  const { contentSha256, ...evidence } = artifact;
  assert.equal(contentSha256, sha256(canonicalJson(evidence)));
  return artifact;
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
