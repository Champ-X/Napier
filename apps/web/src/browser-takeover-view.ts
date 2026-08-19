import type {
  BrowserTakeoverActionReceipt,
  BrowserTakeoverKey,
  ExecuteBrowserTakeoverActionRequest,
} from "@napier/contracts/browser-takeover";

export type BrowserTakeoverMode = "click" | "type" | "select";

export interface BrowserTakeoverBinding {
  expectedPauseStateSha256: string;
  expectedSessionIdSha256: string;
  expectedSessionOperation: number;
  expectedSnapshotSha256: string;
  expectedActiveTabId: string;
  expectedTabCount: number;
  expectedTabSetSha256: string;
}

export interface BrowserTakeoverFormState {
  mode: BrowserTakeoverMode;
  ref: string;
  value: string;
  newTabUrl: string;
  selectedKey: BrowserTakeoverKey;
  allowCrossOrigin: boolean;
}

export type BrowserTakeoverExecute = (
  request: ExecuteBrowserTakeoverActionRequest,
) => Promise<BrowserTakeoverActionReceipt | undefined>;
