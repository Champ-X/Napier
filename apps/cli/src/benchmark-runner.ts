import path from "node:path";

export { CLI_VERSION, runCli } from "./cli.js";
export type { RunCliDependencies } from "./cli-runtime.js";

export function compiledCliEntry(): string {
  return path.basename(import.meta.dirname) === "src"
    ? path.resolve(import.meta.dirname, "../dist/index.js")
    : path.join(import.meta.dirname, "index.js");
}
