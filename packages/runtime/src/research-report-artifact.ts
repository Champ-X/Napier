import type { BrowserSessionOwner } from "./browser-session-model.js";
import type {
  ResearchReportArtifactRegistration,
  ResearchSourceResult,
  ResearchSourceToolDetails,
} from "./research-source-model.js";
import type { ResearchSourceCapsuleReceipt } from "./research-source-capsule.js";
import {
  RunBoundFileArtifactRegistrar,
  type RunBoundFileArtifactStore,
} from "./run-bound-file-artifact.js";

export interface VerifiedResearchReportFile {
  path: string;
  pathSha256: string;
  fileSha256: string;
  fileBytes: number;
  citationCount: number;
  citationSetSha256: string;
}

export class ResearchReportArtifactRegistrar {
  private readonly files: RunBoundFileArtifactRegistrar | undefined;

  constructor(store?: RunBoundFileArtifactStore) {
    this.files = store ? new RunBoundFileArtifactRegistrar(store) : undefined;
  }

  async register(
    owner: BrowserSessionOwner,
    report: VerifiedResearchReportFile,
  ): Promise<ResearchReportArtifactRegistration | undefined> {
    if (!this.files) return undefined;
    try {
      const result = await this.files.register(owner, {
        path: report.path,
        fileSha256: report.fileSha256,
        fileBytes: report.fileBytes,
        producedEvidence:
          "Research report verification found the declared Markdown file.",
        verifiedEvidence:
          "Research Source verified the declared Markdown report and citations.",
      });
      return result.reason === "artifact_registered"
        ? "registered"
        : result.reason;
    } catch {
      return "artifact_registration_failed";
    }
  }
}

export function verifiedResearchReportResult(input: {
  report: VerifiedResearchReportFile;
  registration: ResearchReportArtifactRegistration | undefined;
  counts: Pick<
    ResearchSourceToolDetails,
    "sourceCount" | "citationCount" | "sourceSetSha256"
  >;
  stateCapsule?: ResearchSourceCapsuleReceipt;
}): ResearchSourceResult {
  return {
    output: [
      `Research report verified: ${input.report.path}`,
      `File SHA-256: ${input.report.fileSha256}`,
      `Citations: ${input.report.citationCount}`,
    ].join("\n"),
    details: {
      kind: "napier.research-source",
      schemaVersion: 1,
      action: "verify_report",
      ...input.counts,
      reportPathSha256: input.report.pathSha256,
      reportFileSha256: input.report.fileSha256,
      reportFileBytes: input.report.fileBytes,
      reportCitationCount: input.report.citationCount,
      reportCitationSetSha256: input.report.citationSetSha256,
      ...(input.registration
        ? { reportArtifactRegistration: input.registration }
        : {}),
      ...(input.stateCapsule ? { stateCapsule: input.stateCapsule } : {}),
    },
  };
}
