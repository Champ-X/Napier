import { canonicalJson } from "./ed25519.js";
import { LocalPrivateCapsuleStore } from "./local-private-capsule-store.js";
import {
  createResearchSourceCapsule,
  createResearchSourceCapsuleReceipt,
  MAX_RESEARCH_SOURCE_CAPSULE_BYTES,
  type ResearchSourceCapsule,
  type ResearchSourceCapsuleReceipt,
  validateResearchSourceCapsule,
} from "./research-source-capsule.js";
import type {
  ResearchSourceCitationRecord,
  ResearchSourceEvidenceRecord,
} from "./research-source-evidence.js";

export const MAX_RESEARCH_SOURCE_CAPSULES = 4_096;
export const MAX_RESEARCH_SOURCE_CAPSULE_STORAGE_BYTES = 128 * 1024 * 1024;

export class ResearchSourceCapsuleStore {
  private readonly capsules: LocalPrivateCapsuleStore<ResearchSourceCapsule>;
  readonly rootPath: string;

  constructor(dataRoot: string) {
    this.capsules = new LocalPrivateCapsuleStore({
      dataRoot,
      directory: "research-sources",
      label: "Research Source",
      maxObjectBytes: MAX_RESEARCH_SOURCE_CAPSULE_BYTES,
      maxObjects: MAX_RESEARCH_SOURCE_CAPSULES,
      maxStorageBytes: MAX_RESEARCH_SOURCE_CAPSULE_STORAGE_BYTES,
      parse(serialized) {
        return validateResearchSourceCapsule(JSON.parse(serialized));
      },
      contentSha256(capsule) {
        return capsule.contentSha256;
      },
    });
    this.rootPath = this.capsules.rootPath;
  }

  async put(input: {
    sourceThreadId: string;
    sourceRunId: string;
    sources: Iterable<ResearchSourceEvidenceRecord>;
    citations: readonly ResearchSourceCitationRecord[];
  }): Promise<ResearchSourceCapsuleReceipt> {
    const capsule = createResearchSourceCapsule(input);
    const stored = await this.capsules.put(
      capsule.contentSha256,
      canonicalJson(capsule),
    );
    return createResearchSourceCapsuleReceipt(stored.value, stored.bytes);
  }

  read(capsuleSha256: string): Promise<ResearchSourceCapsule> {
    return this.capsules.read(capsuleSha256);
  }
}
