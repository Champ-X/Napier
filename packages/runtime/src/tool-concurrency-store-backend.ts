import type {
  ClaimDurableToolConcurrencyLeaseInput,
  InspectDurableToolConcurrencyLeaseInput,
  RenewDurableToolConcurrencyLeaseInput,
  ToolConcurrencyLeaseBackend,
} from "./tool-concurrency-lease-backend.js";

export function createLazyToolConcurrencyLeaseBackend(
  resolve: () => ToolConcurrencyLeaseBackend,
): ToolConcurrencyLeaseBackend {
  return {
    claim: (input: ClaimDurableToolConcurrencyLeaseInput) =>
      resolve().claim(input),
    renew: (input: RenewDurableToolConcurrencyLeaseInput) =>
      resolve().renew(input),
    assertCurrent: (input: InspectDurableToolConcurrencyLeaseInput) =>
      resolve().assertCurrent(input),
    release: (input: InspectDurableToolConcurrencyLeaseInput) =>
      resolve().release(input),
  };
}
