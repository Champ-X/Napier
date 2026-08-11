import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "../packages/runtime/dist/index.js";

const PLATFORMS = ["linux/amd64", "linux/arm64"];
const OCI_INDEX_MEDIA_TYPE = "application/vnd.oci.image.index.v1+json";
const OCI_MANIFEST_MEDIA_TYPE = "application/vnd.oci.image.manifest.v1+json";
const MAX_LAYOUT_BYTES = 512 * 1024 * 1024;

export async function inspectSandboxOciLayout(layoutRoot, source) {
  const layout = await readJson(path.join(layoutRoot, "oci-layout"));
  if (
    Object.keys(layout).join("\n") !== "imageLayoutVersion" ||
    layout.imageLayoutVersion !== "1.0.0"
  ) {
    throw new Error("OCI image layout version is invalid");
  }
  const rootIndexBytes = await readFile(path.join(layoutRoot, "index.json"));
  const rootIndex = parseJson(rootIndexBytes);
  if (
    rootIndex.schemaVersion !== 2 ||
    rootIndex.mediaType !== OCI_INDEX_MEDIA_TYPE ||
    !Array.isArray(rootIndex.manifests) ||
    rootIndex.manifests.length !== 1
  ) {
    throw new Error("OCI root index is invalid");
  }
  const reached = new Set();
  const imageIndexBytes = await readDescriptor(
    layoutRoot,
    rootIndex.manifests[0],
    reached,
  );
  const imageIndex = parseJson(imageIndexBytes);
  if (
    imageIndex.schemaVersion !== 2 ||
    imageIndex.mediaType !== OCI_INDEX_MEDIA_TYPE ||
    !Array.isArray(imageIndex.manifests) ||
    imageIndex.manifests.length !== PLATFORMS.length
  ) {
    throw new Error("OCI multi-architecture index is invalid");
  }
  const platforms = [];
  for (const descriptor of imageIndex.manifests) {
    const platform = `${String(descriptor.platform?.os)}/${String(
      descriptor.platform?.architecture,
    )}`;
    if (
      descriptor.mediaType !== OCI_MANIFEST_MEDIA_TYPE ||
      !PLATFORMS.includes(platform)
    ) {
      throw new Error("OCI platform descriptor is invalid");
    }
    const manifestBytes = await readDescriptor(layoutRoot, descriptor, reached);
    const manifest = parseJson(manifestBytes);
    if (
      manifest.schemaVersion !== 2 ||
      manifest.mediaType !== OCI_MANIFEST_MEDIA_TYPE ||
      !manifest.config ||
      !Array.isArray(manifest.layers) ||
      manifest.layers.length === 0
    ) {
      throw new Error("OCI image manifest is invalid");
    }
    const configBytes = await readDescriptor(
      layoutRoot,
      manifest.config,
      reached,
    );
    const config = parseJson(configBytes);
    if (
      `${String(config.os)}/${String(config.architecture)}` !== platform ||
      config.config?.Labels?.["io.napier.sandbox.context-sha256"] !==
        source.contextSha256 ||
      config.config?.Labels?.["org.opencontainers.image.version"] !== "0.1.0" ||
      !Array.isArray(config.rootfs?.diff_ids) ||
      config.rootfs.diff_ids.length !== manifest.layers.length
    ) {
      throw new Error("OCI image config is not bound to the Sandbox source");
    }
    for (const layer of manifest.layers) {
      await readDescriptor(layoutRoot, layer, reached);
    }
    platforms.push({
      platform,
      manifestDigest: descriptor.digest,
      manifestBytes: descriptor.size,
      configDigest: manifest.config.digest,
      layerCount: manifest.layers.length,
      layerSetSha256: sha256(
        canonicalJson(manifest.layers.map((layer) => layer.digest).sort()),
      ),
      contextSha256: source.contextSha256,
    });
  }
  platforms.sort((left, right) => left.platform.localeCompare(right.platform));
  if (
    platforms.map((item) => item.platform).join("\n") !== PLATFORMS.join("\n")
  ) {
    throw new Error("OCI platform set is incomplete");
  }
  const blobRoot = path.join(layoutRoot, "blobs/sha256");
  const blobNames = (await readdir(blobRoot)).sort();
  let blobBytes = 0;
  for (const name of blobNames) {
    if (!/^[a-f0-9]{64}$/u.test(name)) {
      throw new Error("OCI blob name is invalid");
    }
    const bytes = await readFile(path.join(blobRoot, name));
    if (sha256(bytes) !== name) throw new Error("OCI blob digest is invalid");
    blobBytes += bytes.byteLength;
  }
  if (
    blobBytes <= 0 ||
    blobBytes > MAX_LAYOUT_BYTES ||
    blobNames.join("\n") !== [...reached].sort().join("\n")
  ) {
    throw new Error("OCI layout contains an invalid blob closure");
  }
  const imageIndexDescriptor = rootIndex.manifests[0];
  const content = {
    layoutVersion: "1.0.0",
    rootIndexSha256: sha256(rootIndexBytes),
    imageIndexDigest: imageIndexDescriptor.digest,
    imageIndexBytes: imageIndexDescriptor.size,
    platforms,
    blobCount: blobNames.length,
    blobBytes,
    blobSetSha256: sha256(canonicalJson(blobNames)),
    allBlobDigestsVerified: true,
    completeReachabilityClosure: true,
  };
  return {
    ...content,
    evidenceSha256: sha256(canonicalJson(content)),
  };
}

async function readDescriptor(layoutRoot, descriptor, reached) {
  const match =
    typeof descriptor?.digest === "string"
      ? /^sha256:([a-f0-9]{64})$/u.exec(descriptor.digest)
      : null;
  if (
    !match ||
    !Number.isSafeInteger(descriptor.size) ||
    descriptor.size <= 0
  ) {
    throw new Error("OCI descriptor is invalid");
  }
  const bytes = await readFile(path.join(layoutRoot, "blobs/sha256", match[1]));
  if (bytes.byteLength !== descriptor.size || sha256(bytes) !== match[1]) {
    throw new Error("OCI descriptor bytes do not match their digest");
  }
  reached.add(match[1]);
  return bytes;
}

function readJson(filePath) {
  return readFile(filePath).then(parseJson);
}

function parseJson(bytes) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("OCI layout JSON is invalid");
  }
}
