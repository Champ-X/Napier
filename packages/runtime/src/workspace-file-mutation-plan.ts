import type { WorkspaceTrashItem } from "@napier/contracts";
import { canonicalJson, sha256 } from "./ed25519.js";
import { scopeFromSnapshot, type MissingPathPlan, type WorkspaceEntrySnapshot } from "./workspace-file-scope.js";

export type WorkspaceFileMutationRequest =
  | {
      operation: "create_directory";
      path: string;
      createParentDirectories?: boolean;
    }
  | {
      operation: "move";
      sourcePath: string;
      destinationPath: string;
    }
  | {
      operation: "trash";
      path: string;
    }
  | {
      operation: "restore";
      trashId: string;
    };

export interface WorkspaceFileMutationPlan {
  request: WorkspaceFileMutationRequest;
  sourcePath?: string;
  destinationPath?: string;
  source?: WorkspaceEntrySnapshot;
  destination: MissingPathPlan;
  trashId?: string;
  trashItem?: WorkspaceTrashItem;
  lockTargets: string[];
  reversible: boolean;
  planSha256: string;
}

export function planFingerprint(
  plan: Omit<WorkspaceFileMutationPlan, "planSha256">,
): string {
  return sha256(
    canonicalJson({
      operation: plan.request.operation,
      sourcePathSha256: plan.sourcePath ? sha256(plan.sourcePath) : null,
      destinationPathSha256: plan.destinationPath
        ? sha256(plan.destinationPath)
        : null,
      source: plan.source ? scopeFromSnapshot(plan.source) : null,
      destinationMissingDirectorySetSha256: sha256(
        canonicalJson(
          plan.destination.missingDirectories.map((directory) =>
            sha256(directory),
          ),
        ),
      ),
      destinationParentStateSha256: plan.destination.parentStateSha256,
      trashId: plan.trashId ?? null,
      trashManifestSha256: plan.trashItem?.contentSha256 ?? null,
      reversible: plan.reversible,
    }),
  );
}
