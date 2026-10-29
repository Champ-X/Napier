import type { ModelRegistry } from "@napier/runtime/model";
import { modelAccountingBinding } from "../../../packages/runtime/dist/model-accounting-binding.js";
import { enterPreparedModelCall, issueModelUsagePreparationAuthority, issuePreparedModelCall,
  readEnteredModelCall, type EnteredModelCall } from "../../../packages/runtime/dist/model-call-attribution.js";

type Admission = NonNullable<ConstructorParameters<typeof ModelRegistry>[1]>;

/** Test-only private source seam; no source/delivery capability is exported by Runtime. */
export function hostFixtureSource(admission: Admission) {
  const binding = modelAccountingBinding(admission);
  if (!binding) throw new Error("Host fixture admission has no native binding");
  return binding.source;
}

/** Exercises source/policy faults with explicit private native fixture authority. */
export function reserveHostFixture(admission: Admission, input: Parameters<Admission["reserve"]>[0], entered?: EnteredModelCall) {
  const attribution = input.attribution;
  if (!attribution) throw new Error("Native fixture attribution required");
  const repository = {};
  const call = entered ?? enterPreparedModelCall(issuePreparedModelCall({ repository, attribution,
    authority: issueModelUsagePreparationAuthority({ repository,
      owner: { kind: "operation", operationId: "host-accounting-fixture", operation: "standalone_model_call" } }) }));
  return modelAccountingBinding(admission)!.reserve({ ...input, attribution: readEnteredModelCall(call).attribution }, call);
}
