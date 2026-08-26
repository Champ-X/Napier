import type { ArtifactManifestEntry } from "@napier/contracts";

import { GitInspectRunner } from "./git-inspect.js";
import { isPathInsideWorkspace } from "./policy.js";
import type { OsSandboxAdapter } from "./sandbox.js";

export interface WorkspaceArtifactDiffPreview {
  scope: "working";
  text: string;
  outputSha256: string;
  outputBytes: number;
  fileCount: number;
  hunkCount: number;
  addedLineCount: number;
  deletedLineCount: number;
  repositoryStateSha256: string;
}

export async function previewWorkspaceArtifactDiff(
  workspaceRoot: string,
  artifact: ArtifactManifestEntry,
  sandbox: OsSandboxAdapter,
): Promise<WorkspaceArtifactDiffPreview> {
  if (artifact.kind !== "file") {
    throw new Error("Only file artifacts can be diffed");
  }
  if (artifact.status !== "produced" && artifact.status !== "verified") {
    throw new Error("Only produced or verified artifacts can be diffed");
  }
  if (!isPathInsideWorkspace(artifact.path, workspaceRoot)) {
    throw new Error("Artifact path escapes the configured workspace");
  }
  const result = await new GitInspectRunner({ workspaceRoot, sandbox }).inspect({
    action: "diff",
    scope: "working",
    path: artifact.path,
    contextLines: 3,
  });
  return {
    scope: "working",
    text: result.output,
    outputSha256: result.details.outputSha256,
    outputBytes: result.details.outputBytes,
    fileCount: result.details.fileCount,
    hunkCount: result.details.hunkCount,
    addedLineCount: result.details.addedLineCount,
    deletedLineCount: result.details.deletedLineCount,
    repositoryStateSha256: result.details.repositoryStateSha256,
  };
}
