import type { Api, Model } from "@earendil-works/pi-ai";
import type { ModelAccountingPhase, ModelCallAttributionV1, ModelCallCaptureBinding, ModelCallMethod } from "@napier/contracts/model-accounting";
import type { EnteredModelCall, ModelUndispatchedDriverProof, ModelUsagePreparationAuthority, PreparedModelCall } from "./model-call-attribution.js";
import type { ModelUsageProjectionPort } from "./model-usage-projection.js";
import type { ModelAttemptReceiptInput, ModelAttemptReceiptView } from "./model-attempt-receipt.js";

export interface ModelCallAccountingRepositoryPort extends ModelUsageProjectionPort {
  readAttemptReceipt(input: ModelAttemptReceiptInput): ModelAttemptReceiptView;
  prepare(input: {
    owner: ModelUsagePreparationAuthority;
    method: ModelCallMethod;
    phase: ModelAccountingPhase;
    logicalCallId: string;
    model: Model<Api>;
    capture: ModelCallCaptureBinding;
    route?: ModelCallAttributionV1["route"];
    recovery?: ModelCallAttributionV1["recovery"];
  }): Promise<PreparedModelCall>;
  enter(call: PreparedModelCall): Promise<EnteredModelCall>;
  rejectUndispatched(proof: ModelUndispatchedDriverProof, reason: string): Promise<unknown>;
  closeUndispatchedChildInvocation(proof: ModelUndispatchedDriverProof, reason: string): Promise<void>;
}

export interface ModelInvocationAccounting {
  repository: ModelCallAccountingRepositoryPort;
  owner: ModelUsagePreparationAuthority;
  logicalCallId: string;
  route?: ModelCallAttributionV1["route"];
  recovery?: ModelCallAttributionV1["recovery"];
}
