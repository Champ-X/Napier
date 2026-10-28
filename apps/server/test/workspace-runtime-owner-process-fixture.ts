import { WorkspaceRuntimeCatalog } from "../src/workspace-runtime-catalog.js";

const [stateHome, workspaceId] = process.argv.slice(2);
if (!stateHome || !workspaceId) throw new Error("Owner fixture requires state and workspace");
const catalog = await WorkspaceRuntimeCatalog.open(stateHome);
catalog.claim(workspaceId);
process.send?.({ status: "owned", workspaceId });
setInterval(() => undefined, 1_000);
