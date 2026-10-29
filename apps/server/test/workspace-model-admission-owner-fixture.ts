import { WorkspaceModelAdmission } from "../src/workspace-model-admission.js";
import { admissionModel, workspaceA } from "./workspace-model-admission-fixture.js";

const [stateHome] = process.argv.slice(2);
if (!stateHome) throw new Error("State home required");
const admission = await WorkspaceModelAdmission.open(stateHome, { maxConcurrent: 1, maxInvocations: 1 });
admission.forWorkspace(workspaceA).reserve({ method: "stream", model: admissionModel });
process.send?.({ reserved: true, snapshot: admission.snapshot() });
setInterval(() => undefined, 1_000);
