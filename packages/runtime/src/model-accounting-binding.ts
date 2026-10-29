import type { ModelCallAdmission, ModelCallLease } from "./model-call-admission-types.js";
import type { EnteredModelCall } from "./model-call-attribution.js";
import type { ModelUsageSource } from "./model-usage-source.js";

interface ModelAccountingBinding {
  source: ModelUsageSource;
  hostWorkspaceId?: string;
  reserve(input: Parameters<ModelCallAdmission["reserve"]>[0], call: EnteredModelCall): ModelCallLease;
}
const bindings = new WeakMap<object, Readonly<ModelAccountingBinding>>();
const nativeReserveFunctions = new WeakSet<object>();

/** Runtime composition only. No source or receipt capability is stored on admission DTOs. */
export function bindModelAccountingSource(admission: ModelCallAdmission, binding: ModelAccountingBinding): void {
  if (bindings.has(admission)) throw new Error("Model accounting admission is already bound");
  bindings.set(admission, Object.freeze({ ...binding }));
  nativeReserveFunctions.add(admission.reserve);
}

export function modelAccountingBinding(admission: ModelCallAdmission | undefined): Readonly<ModelAccountingBinding> | undefined {
  if (!admission) return undefined;
  const binding = bindings.get(admission);
  if (!binding && (typeof admission.reserve !== "function" || nativeReserveFunctions.has(admission.reserve)))
    throw new Error("Native model accounting admission cannot be copied or serialized");
  return binding;
}
