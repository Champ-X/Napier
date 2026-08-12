import { sandboxImageSourceEvidence } from "./check-sandbox-image-sbom.mjs";
import { PublicHttpClient } from "../packages/runtime/dist/public-http-client.js";
import {
  canonicalJson,
  sha256,
} from "./sandbox-external-publication-model.mjs";

export const SANDBOX_EXTERNAL_RELEASE_IMAGE = "ghcr.io/champ-x/napier-sandbox";

const SHA = /^[a-f0-9]{40}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const INDEX_MEDIA_TYPE = "application/vnd.oci.image.index.v1+json";
const MANIFEST_MEDIA_TYPE = "application/vnd.oci.image.manifest.v1+json";
const PLATFORMS = ["linux/amd64", "linux/arm64"];
const MAX_TOKEN_BYTES = 32 * 1024;
const MAX_INDEX_BYTES = 256 * 1024;
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_CONFIG_BYTES = 1024 * 1024;

export async function inspectAnonymousSandboxBootstrap(options) {
  const repoRoot = options.repoRoot;
  const sourceSha = String(options.sourceSha ?? "");
  if (!SHA.test(sourceSha)) {
    throw new Error("Sandbox release visibility source SHA is invalid");
  }
  const request = options.request ?? publicRequest;
  const source = await sandboxImageSourceEvidence(repoRoot);
  const tokenResponse = await request({
    url: tokenUrl(),
    headers: { accept: "application/json" },
    maxBytes: MAX_TOKEN_BYTES,
  });
  if ([401, 403].includes(tokenResponse.status)) {
    return blockedVisibility({
      sourceSha,
      contextSha256: source.contextSha256,
      blocker: "ghcr_anonymous_token_unavailable",
      tokenHttpStatus: tokenResponse.status,
      manifestHttpStatus: null,
      anonymousTokenAcquired: false,
    });
  }
  if (tokenResponse.status !== 200) {
    throw new Error(
      "Sandbox release token endpoint returned an invalid status",
    );
  }
  const token = accessToken(parseJson(tokenResponse.body));
  const tag = `bootstrap-${sourceSha}`;
  const indexResponse = await request({
    url: registryUrl(`/v2/champ-x/napier-sandbox/manifests/${tag}`),
    headers: {
      accept: INDEX_MEDIA_TYPE,
      authorization: `Bearer ${token}`,
    },
    maxBytes: MAX_INDEX_BYTES,
  });
  if ([401, 403, 404].includes(indexResponse.status)) {
    return blockedVisibility({
      sourceSha,
      contextSha256: source.contextSha256,
      blocker: "ghcr_bootstrap_tag_unavailable",
      tokenHttpStatus: tokenResponse.status,
      manifestHttpStatus: indexResponse.status,
      anonymousTokenAcquired: true,
    });
  }
  if (indexResponse.status !== 200) {
    throw new Error("Sandbox bootstrap index returned an invalid status");
  }
  const digest = responseDigest(indexResponse, indexResponse.body);
  const index = parseJson(indexResponse.body);
  if (
    index.schemaVersion !== 2 ||
    index.mediaType !== INDEX_MEDIA_TYPE ||
    !Array.isArray(index.manifests) ||
    index.manifests.length !== PLATFORMS.length
  ) {
    throw new Error("Sandbox bootstrap index shape is invalid");
  }
  const platforms = [];
  for (const descriptor of index.manifests) {
    const platform = `${String(descriptor?.platform?.os)}/${String(
      descriptor?.platform?.architecture,
    )}`;
    if (
      descriptor?.mediaType !== MANIFEST_MEDIA_TYPE ||
      !PLATFORMS.includes(platform)
    ) {
      throw new Error("Sandbox bootstrap platform descriptor is invalid");
    }
    const manifestResponse = await request({
      url: registryUrl(
        `/v2/champ-x/napier-sandbox/manifests/${descriptor.digest}`,
      ),
      headers: {
        accept: MANIFEST_MEDIA_TYPE,
        authorization: `Bearer ${token}`,
      },
      maxBytes: MAX_MANIFEST_BYTES,
    });
    requireDescriptorResponse(
      manifestResponse,
      descriptor,
      "Sandbox bootstrap manifest",
    );
    const manifest = parseJson(manifestResponse.body);
    if (
      manifest.schemaVersion !== 2 ||
      manifest.mediaType !== MANIFEST_MEDIA_TYPE ||
      !validDescriptor(manifest.config) ||
      !Array.isArray(manifest.layers) ||
      manifest.layers.length === 0 ||
      manifest.layers.some((layer) => !validDescriptor(layer))
    ) {
      throw new Error("Sandbox bootstrap manifest shape is invalid");
    }
    const configResponse = await request({
      url: registryUrl(
        `/v2/champ-x/napier-sandbox/blobs/${manifest.config.digest}`,
      ),
      headers: {
        accept: "application/octet-stream",
        authorization: `Bearer ${token}`,
      },
      maxBytes: MAX_CONFIG_BYTES,
    });
    requireDescriptorResponse(
      configResponse,
      manifest.config,
      "Sandbox bootstrap config",
    );
    const config = parseJson(configResponse.body);
    if (
      `${String(config.os)}/${String(config.architecture)}` !== platform ||
      config.config?.Labels?.["io.napier.sandbox.context-sha256"] !==
        source.contextSha256 ||
      config.config?.Labels?.["org.opencontainers.image.revision"] !==
        sourceSha ||
      config.config?.Labels?.["org.opencontainers.image.version"] !== "0.1.0"
    ) {
      throw new Error("Sandbox bootstrap config identity is invalid");
    }
    platforms.push({
      platform,
      manifestDigest: descriptor.digest,
      configDigest: manifest.config.digest,
      layerCount: manifest.layers.length,
      layerSetSha256: sha256(
        canonicalJson(manifest.layers.map((layer) => layer.digest).sort()),
      ),
    });
  }
  platforms.sort((left, right) => left.platform.localeCompare(right.platform));
  if (
    platforms.map((platform) => platform.platform).join("\n") !==
    PLATFORMS.join("\n")
  ) {
    throw new Error("Sandbox bootstrap platform set is invalid");
  }
  const content = {
    status: "ready",
    blocker: null,
    sourceSha,
    contextSha256: source.contextSha256,
    image: SANDBOX_EXTERNAL_RELEASE_IMAGE,
    tag,
    digest,
    tokenHttpStatus: tokenResponse.status,
    manifestHttpStatus: indexResponse.status,
    platforms,
    anonymousTokenAcquired: true,
    indexDigestVerified: true,
    sourceLabelsVerified: true,
  };
  return { ...content, evidenceSha256: sha256(canonicalJson(content)) };
}

function blockedVisibility(input) {
  const content = {
    status: "blocked",
    blocker: input.blocker,
    sourceSha: input.sourceSha,
    contextSha256: input.contextSha256,
    image: SANDBOX_EXTERNAL_RELEASE_IMAGE,
    tag: `bootstrap-${input.sourceSha}`,
    digest: null,
    tokenHttpStatus: input.tokenHttpStatus,
    manifestHttpStatus: input.manifestHttpStatus,
    platforms: [],
    anonymousTokenAcquired: input.anonymousTokenAcquired,
    indexDigestVerified: false,
    sourceLabelsVerified: false,
  };
  return { ...content, evidenceSha256: sha256(canonicalJson(content)) };
}

function accessToken(value) {
  const token =
    typeof value?.token === "string"
      ? value.token
      : typeof value?.access_token === "string"
        ? value.access_token
        : "";
  if (
    token.length < 20 ||
    token.length > 16 * 1024 ||
    !/^[A-Za-z0-9._~+/-]+$/u.test(token)
  ) {
    throw new Error("Sandbox release token response is invalid");
  }
  return token;
}

function requireDescriptorResponse(response, descriptor, label) {
  const computed = `sha256:${sha256(response.body)}`;
  const responseHeader = response.headers?.["docker-content-digest"];
  if (
    response.status !== 200 ||
    !validDescriptor(descriptor) ||
    response.body.byteLength !== descriptor.size ||
    computed !== descriptor.digest ||
    (responseHeader !== undefined && responseHeader !== descriptor.digest)
  ) {
    throw new Error(`${label} bytes are invalid`);
  }
}

function responseDigest(response, body) {
  const digest = response.headers?.["docker-content-digest"];
  const computed = `sha256:${sha256(body)}`;
  if (!DIGEST.test(digest ?? "") || digest !== computed) {
    throw new Error("Sandbox registry response digest is invalid");
  }
  return digest;
}

function validDescriptor(value) {
  return (
    DIGEST.test(value?.digest ?? "") &&
    Number.isSafeInteger(value?.size) &&
    value.size > 0
  );
}

function parseJson(body) {
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw new Error("Sandbox registry response is not valid JSON");
  }
}

async function publicRequest(input) {
  const response = await new PublicHttpClient().request({
    url: input.url,
    headers: input.headers,
    timeoutMs: 20_000,
    maxResponseBytes: input.maxBytes,
    maxRedirects: 4,
  });
  if (response.body.byteLength <= 0) {
    throw new Error("Sandbox registry response has an invalid byte length");
  }
  return {
    status: response.status,
    headers: {
      "docker-content-digest": firstHeader(
        response.headers["docker-content-digest"],
      ),
    },
    body: response.body,
  };
}

function tokenUrl() {
  return registryUrl(
    "/token?service=ghcr.io&scope=repository%3Achamp-x%2Fnapier-sandbox%3Apull",
  );
}

function registryUrl(relative) {
  return `https://ghcr.io${relative}`;
}

function firstHeader(value) {
  return Array.isArray(value) ? value[0] : value;
}
