import path from "node:path";

export function isolatedProductionServerEnvironment(root, environment = {}) {
  const isolatedRoot = path.resolve(root);
  return {
    ...environment,
    NAPIER_HOME: path.join(isolatedRoot, "state"),
    NAPIER_STATE_HOME: path.join(isolatedRoot, "state"),
    NAPIER_WORKSPACE: path.join(isolatedRoot, "workspace"),
    TMPDIR: path.join(isolatedRoot, "tmp"),
  };
}
