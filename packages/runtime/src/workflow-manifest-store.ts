import type { ExecutionPlanWorkflowManifest } from "@napier/contracts";

import { LocalPrivateCapsuleStore } from "./local-private-capsule-store.js";
import {
  MAX_EXECUTION_PLAN_WORKFLOW_MANIFEST_BYTES,
  validateExecutionPlanWorkflowManifest,
} from "./workflow-manifests.js";

/** Executable definitions stay private; only their intrinsic digest enters the ledger. */
export function workflowManifestStore(dataRoot: string) {
  return new LocalPrivateCapsuleStore<ExecutionPlanWorkflowManifest>({
    dataRoot,
    directory: "workflow-manifests",
    label: "Workflow manifest",
    maxObjectBytes: MAX_EXECUTION_PLAN_WORKFLOW_MANIFEST_BYTES,
    maxObjects: 2048,
    maxStorageBytes: 128 * 1024 * 1024,
    parse: (serialized) =>
      validateExecutionPlanWorkflowManifest(JSON.parse(serialized)),
    contentSha256: (manifest) => manifest.contentSha256,
  });
}
