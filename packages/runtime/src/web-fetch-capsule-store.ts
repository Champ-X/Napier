import { canonicalJson } from "./ed25519.js";
import { LocalPrivateCapsuleStore } from "./local-private-capsule-store.js";
import {
  createWebFetchSourceCapsule,
  createWebFetchStateCapsuleReceipt,
  createWebFetchStateManifestCapsule,
  MAX_WEB_FETCH_MANIFEST_CAPSULE_BYTES,
  MAX_WEB_FETCH_SOURCE_CAPSULE_BYTES,
  type WebFetchSourceCapsule,
  type WebFetchStateCapsuleReceipt,
  type WebFetchStateManifestCapsule,
  validateWebFetchSourceCapsule,
  validateWebFetchStateManifestCapsule,
} from "./web-fetch-capsule.js";
import type { WebFetchSource } from "./web-fetch-model.js";

const MAX_SOURCE_CAPSULES = 4_096;
const MAX_SOURCE_STORAGE_BYTES = 512 * 1024 * 1024;
const MAX_MANIFEST_CAPSULES = 4_096;
const MAX_MANIFEST_STORAGE_BYTES = 32 * 1024 * 1024;

export class WebFetchCapsuleStore {
  private readonly sources: LocalPrivateCapsuleStore<WebFetchSourceCapsule>;
  private readonly manifests: LocalPrivateCapsuleStore<WebFetchStateManifestCapsule>;
  readonly sourceRootPath: string;
  readonly manifestRootPath: string;

  constructor(dataRoot: string) {
    this.sources = new LocalPrivateCapsuleStore({
      dataRoot,
      directory: "web-fetch-sources",
      label: "Web Fetch Source",
      maxObjectBytes: MAX_WEB_FETCH_SOURCE_CAPSULE_BYTES,
      maxObjects: MAX_SOURCE_CAPSULES,
      maxStorageBytes: MAX_SOURCE_STORAGE_BYTES,
      parse(serialized) {
        return validateWebFetchSourceCapsule(JSON.parse(serialized));
      },
      contentSha256(capsule) {
        return capsule.contentSha256;
      },
    });
    this.manifests = new LocalPrivateCapsuleStore({
      dataRoot,
      directory: "web-fetch-manifests",
      label: "Web Fetch manifest",
      maxObjectBytes: MAX_WEB_FETCH_MANIFEST_CAPSULE_BYTES,
      maxObjects: MAX_MANIFEST_CAPSULES,
      maxStorageBytes: MAX_MANIFEST_STORAGE_BYTES,
      parse(serialized) {
        return validateWebFetchStateManifestCapsule(JSON.parse(serialized));
      },
      contentSha256(capsule) {
        return capsule.contentSha256;
      },
    });
    this.sourceRootPath = this.sources.rootPath;
    this.manifestRootPath = this.manifests.rootPath;
  }

  async putState(input: {
    sourceThreadId: string;
    sourceRunId: string;
    sources: Iterable<WebFetchSource>;
    browserFallbackCount: number;
  }): Promise<WebFetchStateCapsuleReceipt> {
    const sourceEntries = [];
    for (const source of input.sources) {
      const capsule = createWebFetchSourceCapsule(source);
      const stored = await this.sources.put(
        capsule.contentSha256,
        canonicalJson(capsule),
      );
      sourceEntries.push({
        source: stored.value.source,
        capsuleSha256: stored.value.contentSha256,
      });
    }
    const manifest = createWebFetchStateManifestCapsule({
      sourceThreadId: input.sourceThreadId,
      sourceRunId: input.sourceRunId,
      browserFallbackCount: input.browserFallbackCount,
      sources: sourceEntries,
    });
    const storedManifest = await this.manifests.put(
      manifest.contentSha256,
      canonicalJson(manifest),
    );
    return createWebFetchStateCapsuleReceipt(
      storedManifest.value,
      storedManifest.bytes,
    );
  }

  readManifest(capsuleSha256: string): Promise<WebFetchStateManifestCapsule> {
    return this.manifests.read(capsuleSha256);
  }

  readSource(capsuleSha256: string): Promise<WebFetchSourceCapsule> {
    return this.sources.read(capsuleSha256);
  }
}
