export interface LegacyModelContextEnvelopeReceipt {
  kind: "napier.model-context-envelope";
  schemaVersion: 1;
  turnIndex: number;
  systemPromptSha256: string;
  systemPromptBytes: number;
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  toolResultMessageCount: number;
  otherMessageCount: number;
  messageSetSha256: string;
  toolCount: number;
  toolNameSetSha256: string;
  toolDefinitionSetSha256: string;
  contentSha256: string;
}

export interface ModelContextEnvelopeReceiptV2 extends Omit<
  LegacyModelContextEnvelopeReceipt,
  "schemaVersion" | "contentSha256"
> {
  schemaVersion: 2;
  toolDefinitionBytes: number;
  toolDefinitionEstimatedTokens: number;
  toolDefinitionTokenEstimateMethod: "ceil_utf8_bytes_div_4";
  contentSha256: string;
}

export type ModelContextEnvelopeReceipt =
  | LegacyModelContextEnvelopeReceipt
  | ModelContextEnvelopeReceiptV2;
