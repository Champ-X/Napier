import type { ThreadRecord } from "@napier/contracts";
import type { SubagentChildRunHost } from "./subagent-child-run-host.js";
import type { LedgerModelAccountingPort } from "./sqlite-model-accounting.js";

export interface ModelAccountingHost extends Omit<SubagentChildRunHost, "requireLedger"> {
  requireLedger(): LedgerModelAccountingPort;
  getThread(threadId: string): ThreadRecord;
}
