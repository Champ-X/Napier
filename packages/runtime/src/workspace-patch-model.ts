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
