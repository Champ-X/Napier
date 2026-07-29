export const workspaceProcessCopy = {
  eyebrow: "SANDBOX SESSIONS",
  title: "Workspace processes",
  description:
    "Observe bounded background Node work without granting shell, network, or workspace write access.",
  refresh: "Refresh",
  cancel: "Cancel process",
  cancelling: "Cancelling...",
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
  deltaTruncated:
    "Only the first 256 paths are shown. The count and path-set hash cover the complete observed delta.",
  beforeHash: "before",
  afterHash: "after",
  beforeSize: "before bytes",
  afterSize: "after bytes",
  commandHash: "Command",
  outputHashes: "stdout / stderr",
  started: "Started",
  settled: "Settled",
  duration: "Duration",
  limits: "Limits",
  scope: "Scope",
  output: "Output",
  error: "Process Sessions could not be loaded.",
} as const;
