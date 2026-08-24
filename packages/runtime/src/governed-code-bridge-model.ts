export interface GovernedCodeBridgeRequest {
  evaluationId: string;
  callId: number;
  toolId: string;
  input: unknown;
}

export interface GovernedCodeBridgeResult {
  content: unknown[];
  details: unknown;
  isError: boolean;
}

export type GovernedCodeBridgeDispatcher = (
  request: GovernedCodeBridgeRequest,
  signal?: AbortSignal,
) => Promise<GovernedCodeBridgeResult>;
