export const MODEL_INVOCATION_EXPERIMENT_EXECUTION: unique symbol = Symbol(
  "napier.model-invocation-experiment-execution",
);

export interface ModelInvocationExperimentExecution {
  sourceThreadId: string;
  sourceRunId: string;
  sourceTurnIndex: number;
  sourceCapsuleEventSeq: number;
  sourceResponseEventSeq: number;
  sourceAgentRevision: number;
  sourceContextEnvelopeSha256: string;
  sourceContextSha256: string;
  sourceCapsuleSha256: string;
  targetModel: {
    provider: string;
    id: string;
  };
  previewSha256: string;
}
