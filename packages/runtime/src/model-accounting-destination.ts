import type { ModelAccountingRepository, ModelAccountingSourceConfiguration } from "./model-accounting-repository.js";
import type { VerifiedModelUsageDelivery } from "./model-usage-delivery.js";

interface NativeAccountingDestination {
  configureSource(configuration: ModelAccountingSourceConfiguration): void;
  workspaceLedgerId(): string;
  reconcile(delivery: VerifiedModelUsageDelivery): ReturnType<ModelAccountingRepository["reconcile"]>;
}
const destinations = new WeakMap<object, Readonly<NativeAccountingDestination>>();

/** Called only by the native Store composition seam, never from imported objects. */
export function bindNativeAccountingDestination(store: object, repository: ModelAccountingRepository): void {
  if (destinations.has(store) || destinations.has(repository)) throw new Error("Native accounting destination is already bound");
  const destination = Object.freeze({
    configureSource: repository.configureSource.bind(repository),
    workspaceLedgerId: repository.workspaceLedgerId.bind(repository),
    reconcile: repository.reconcile.bind(repository),
  });
  destinations.set(store, destination);
  destinations.set(repository, destination);
}

export function nativeAccountingDestination(store: object): Readonly<NativeAccountingDestination> {
  const destination = destinations.get(store);
  if (!destination) throw new Error("Native Store accounting destination is required");
  return destination;
}
