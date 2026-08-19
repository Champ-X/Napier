import { deepMergeCopy, getLocale } from "./locale";
import { toolInvocationExperimentCopyZh } from "./tool-invocation-experiment-copy.zh";

export const toolInvocationExperimentCopyEn = {
  eyebrow: "Controlled re-execution / tool checkpoint",
  title: "Read-only tool call",
  body: "Run one captured built-in read-only tool against a freshly bound workspace scope. Exact arguments and output bodies stay folded.",
  checkpoint: "Captured call",
  selectCheckpoint: "Select a completed captured tool call",
  titleLabel: "Target title",
  titlePlaceholder: "Optional isolated target title",
  preview: "Preview call",
  previewing: "Binding call...",
  reset: "Reset",
  empty:
    "No completed captured read-only tool call is available in this Thread.",
  sourceRunning: "Wait for the active source Run to settle before previewing.",
  previewReady: "Fresh call preview",
  readOnly: "ONE READ-ONLY CALL",
  source: "SOURCE",
  candidate: "CANDIDATE",
  definition: "Tool definition",
  arguments: "Private arguments",
  workspace: "Workspace scope",
  capsule: "Local capsule",
  sourceOutput: "Source output",
  sourceDuration: "Source duration",
  previewBinding: "PREVIEW",
  execute: "Execute one call",
  cancel: "Cancel",
  frames: "frames",
  comparison: "Call comparison",
  outputChanged: "Output changed",
  outputUnchanged: "Output unchanged",
  duration: "Duration delta",
  bytes: "Output bytes delta",
  sourceBytes: "Source bytes",
  targetBytes: "Candidate bytes",
  openTarget: "Open target",
  download: "Download result",
  safety:
    "Only strict local receipts from terminal Runs are listed. Extensions, Sessions, write tools, exact arguments, workspace paths, and output bodies are not rendered.",
  errors: {
    checkpointRequired: "Select a captured tool call first.",
    previewRequired: "Create a fresh preview before execution.",
  },
} as const;

export const toolInvocationExperimentCopy = deepMergeCopy(
  toolInvocationExperimentCopyEn,
  getLocale() === "zh" ? toolInvocationExperimentCopyZh : {},
);
