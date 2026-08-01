export const workspaceProcessCopy = {
  eyebrow: "SANDBOX SESSIONS",
  title: "Workspace processes",
  description:
    "Observe bounded background Node work, including one-use preview-bound writes to explicit workspace scopes. Shell and network access remain denied.",
  refresh: "Refresh",
  cancel: "Cancel process",
  cancelling: "Cancelling...",
  sendInput: "Send line",
  sendingInput: "Sending...",
  closeInput: "Close stdin",
  closingInput: "Closing...",
  inputLabel: "Process input",
  inputPlaceholder: "UTF-8 input for this sandboxed process",
  inputSafety:
    "Input text is sent to the live process and is not stored in the Ledger. Do not send secrets.",
  ptyInputSafety:
    "Terminal input is live-only. Control bytes are sent literally; a PTY cannot use pipe close semantics.",
  inputReceipt: "Input receipt",
  stdin: "Stdin",
  showOutput: "Show output",
  hideOutput: "Hide output",
  showDelta: "Inspect workspace delta",
  hideDelta: "Hide workspace delta",
  noSessions: "No Process Sessions have been started for this Thread.",
  outputUnavailable:
    "Output text is unavailable after Runtime restart. Ledger hashes and settlement evidence remain.",
  noOutput: "No output has been observed at this cursor.",
  liveOutput: "Live output",
  workspaceDelta: "Workspace window",
  deltaHashes: "before / after / paths",
  deltaUnavailable:
    "Relative paths are unavailable after Runtime restart. The durable summary remains.",
  noDelta: "No file changes were observed during this execution window.",
  indeterminateDelta:
    "The snapshot limit or an unavailable snapshot prevents a complete comparison.",
  deltaAttribution:
    "Changes may come from another local process; this view does not attribute a writer.",
  scopedDeltaAttribution:
    "Every observed change is inside the approved Process write scope. Inspect the exact local paths before accepting the result.",
  outsideScopeDelta:
    "At least one observed change is outside the approved Process write scope. Attribution is unknown; inspect the workspace before continuing.",
  deltaTruncated:
    "Only the first 256 paths are shown. The count and path-set hash cover the complete observed delta.",
  beforeHash: "before",
  afterHash: "after",
  beforeSize: "before bytes",
  afterSize: "after bytes",
  deltaFile: "file",
  deltaDirectory: "directory",
  deltaSymlink: "symlink",
  reviewRollback: "Review rollback",
  reviewingRollback: "Checking recovery...",
  rollbackTitle: "Restore approved write scopes",
  rollbackBody:
    "This replaces every approved scope with its private pre-execution snapshot. Any workspace change after settlement blocks the operation.",
  rollbackOutsideScope:
    "The Process window includes changes outside the approved scopes. This action restores approved scopes only.",
  rollbackScopeCount: "Scopes",
  rollbackEntryCount: "Snapshot entries",
  rollbackBytes: "Snapshot bytes",
  confirmRollback: "Restore scopes",
  applyingRollback: "Restoring...",
  cancelRollback: "Keep current workspace",
  rollbackRestored: "Approved scopes restored",
  rollbackReverted: "Rollback failed and the current workspace was restored",
  rollbackIndeterminate:
    "Rollback outcome is indeterminate. Inspect the workspace before continuing.",
  rollbackEvidence: "Rollback evidence",
  rollbackError:
    "Rollback was rejected or its outcome is unknown. Refresh the session and inspect the workspace before retrying.",
  failureRecovery: "Failure recovery",
  failureRecoveryRestore: "Restore approved scopes after unsuccessful exit",
  compensationPending: "Pending process settlement",
  compensationNotNeeded: "Not needed",
  compensationRestored: "Approved scopes restored automatically",
  compensationReverted: "Automatic restore reverted; operator review available",
  compensationIndeterminate:
    "Automatic restore is indeterminate; inspect the workspace",
  compensationUnavailable:
    "Automatic restore was not safe; operator review may be available",
  commandHash: "Command",
  outputHashes: "stdout / stderr",
  started: "Started",
  settled: "Settled",
  duration: "Duration",
  limits: "Limits",
  scope: "Scope",
  output: "Output",
  error: "Process Sessions could not be loaded.",
  inputError:
    "Process input was rejected or its outcome is unknown. Refresh the session before retrying.",
} as const;
