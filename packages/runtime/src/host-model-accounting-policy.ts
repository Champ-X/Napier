import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ModelCallAttributionV1, ModelPhysicalObservationV1 } from "@napier/contracts/model-accounting";
import type { ModelCallAdmission, ModelCallAdmissionCode } from "./model-call-admission.js";

export interface HostModelReservation {
  readonly id: string;
  readonly workspaceId: string;
}

export type HostModelPhysicalResult =
  | { kind: "attributed"; observation: ModelPhysicalObservationV1 }
  | { kind: "legacy"; message?: AssistantMessage };

/** Trusted synchronous policy updates. The accounting owner supplies the Host DB transaction. */
export interface HostModelAccountingPolicy<Reservation extends HostModelReservation> {
  assertOpen(): void;
  reserve(workspaceId: string, input: Parameters<ModelCallAdmission["reserve"]>[0]): Reservation;
  settle(reservation: Reservation, result: HostModelPhysicalResult): void;
  undispatched(attribution: ModelCallAttributionV1, observation: ModelPhysicalObservationV1,
    recorded: "inserted" | "duplicate"): void;
  acknowledge(attribution: ModelCallAttributionV1, observation: ModelPhysicalObservationV1): void;
  errorCode(error: unknown): ModelCallAdmissionCode | undefined;
  isDeclaredZeroCost(model: { provider: string; id: string }): boolean;
}
