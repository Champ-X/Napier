/** Host-verified file identity. Observation does not establish who wrote bytes. */
export type ToolFileReceiptPayload = {
  [key: string]: string | number;
  /** Stable actual tool invocation or native session-operation identity. */
  operationId: string;
  threadId: string;
  runId: string;
  path: string;
  fileSha256: string;
  fileBytes: number;
  toolName: "browser" | "research_source" | "web_fetch";
  action: "download" | "save_screenshot" | "verify_report" | "save";
  materialization: "produced" | "observed";
  evidence: string;
};
