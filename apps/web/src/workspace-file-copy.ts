export const workspaceFileCopy = {
  eyebrow: "REVERSIBLE FILE OPERATIONS",
  title: "Workspace recovery",
  description:
    "Inspect entries moved to Napier-managed trash and restore them to their original workspace path.",
  safety:
    "Trash is reversible local recovery storage. Napier never exposes permanent purge or destination overwrite here.",
  refresh: "Refresh recovery items",
  noItems: "No reversible Workspace trash items belong to this Thread.",
  restore: "Restore",
  restoring: "Restoring...",
  restored: "Restored",
  originalPath: "Original path",
  scope: "Scope",
  trashedAt: "Moved to trash",
  snapshot: "Snapshot",
  evidence: "Restore evidence",
  error: "Workspace recovery items could not be loaded.",
  conflict:
    "Restore was blocked because the original path is occupied or the trash bytes changed.",
} as const;
