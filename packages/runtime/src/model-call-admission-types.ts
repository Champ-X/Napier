import type { Api, AssistantMessage, Model, StreamOptions } from "@earendil-works/pi-ai";
import type { ModelCallAttributionV1 } from "@napier/contracts/model-accounting";

export type ModelCallMethod = "stream" | "streamSimple" | "complete" | "completeSimple";
export type ModelCallAdmissionCode = "capacity" | "budget" | "accounting" | "closed";

export interface ModelCallLease {
  /** Undefined does not prove zero usage or permit refunding an uncertain reservation. */
  settle(message?: AssistantMessage): void;
}

export interface ModelCallAdmission {
  isDeclaredZeroCost?(model: { provider: string; id: string }): boolean;
  errorCode?(error: unknown): ModelCallAdmissionCode | undefined;
  /** Synchronous host backpressure. Native accounting is bound privately by Runtime. */
  reserve(input: {
    method: ModelCallMethod;
    model: Model<Api>;
    options?: StreamOptions;
    attribution?: ModelCallAttributionV1;
  }): ModelCallLease;
}
