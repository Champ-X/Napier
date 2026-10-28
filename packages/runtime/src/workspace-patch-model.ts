import type {
  WorkspacePatchDiagnosticsDetails,
  WriteLinkedTestVerificationDetails,
} from "@napier/contracts";

export type WorkspacePatchInput =
  | {
      operation: "create";
      path: string;
      expectedSha256: null;
      content: string;
      createParentDirectories?: boolean;
    }
  | {
      operation: "replace";
      path: string;
      expectedSha256: string;
      edits: Array<{ oldText: string; newText: string }>;
    }
  | {
      operation: "hashline_replace";
      path: string;
      expectedSha256: string;
      edits: Array<{
        line?: number;
        anchorSha256: string;
        newText: string;
      }>;
    }
  | {
      operation: "hashrange_replace";
      path: string;
      expectedSha256: string;
      edits: Array<{
        startLine: number;
        endLine: number;
        rangeSha256: string;
        newText: string;
      }>;
    };

export interface WorkspacePatchResult {
  path: string;
  pathSha256: string;
  operation: WorkspacePatchInput["operation"];
  beforeSha256: string | null;
  afterSha256: string;
  beforeBytes: number;
  afterBytes: number;
  editCount: number;
  createdParentDirectoryCount?: number;
  createdParentDirectorySetSha256?: string;
}

export interface WorkspacePatchObservationState {
  fileSha256: string;
  opaque: unknown;
}

export interface WorkspacePatchObservation {
  summary: string;
  details?: WorkspacePatchDiagnosticsDetails;
  tests?: WriteLinkedTestVerificationDetails;
}

export interface WorkspacePatchObserver {
  supports(path: string): boolean;
  observeBefore(input: {
    path: string;
    expectedSha256: string;
    signal?: AbortSignal;
  }): Promise<WorkspacePatchObservationState>;
  observeAfter(input: {
    path: string;
    expectedSha256: string;
    before?: WorkspacePatchObservationState;
    signal?: AbortSignal;
  }): Promise<WorkspacePatchObservation>;
}

export interface WorkspacePatchToolDetails extends Omit<
  WorkspacePatchResult,
  "path"
> {
  kind: "napier.workspace-patch";
  schemaVersion: 1;
  diagnostics?: WorkspacePatchDiagnosticsDetails;
  tests?: WriteLinkedTestVerificationDetails;
  resultSha256: string;
  recoveryCapsuleSha256?: string;
}
