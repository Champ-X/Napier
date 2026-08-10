export const NODE_DEBUGGER_RUNTIME_PROBE_MARKER =
  "napier_node_debugger_runtime_v1";

const WORKER_SOURCE = String.raw`
const inspector = require("node:inspector");
const module_ = require("node:module");
const { parentPort } = require("node:worker_threads");
const zlib = require("node:zlib");
if (
  typeof inspector.Session !== "function" ||
  typeof inspector.Session.prototype.connectToMainThread !== "function" ||
  typeof module_.SourceMap !== "function" ||
  typeof zlib.inflateSync !== "function"
) {
  throw new Error("Node debugger runtime primitives are unavailable");
}
const session = new inspector.Session();
session.connectToMainThread();
session.disconnect();
parentPort.postMessage("ready");
`;

/**
 * A fixed, bounded capability probe for the exact Node primitives used by the
 * production debugger adapter. It runs an Inspector session from a Worker and
 * connects it to the main thread instead of merely checking module presence.
 */
export const NODE_DEBUGGER_RUNTIME_PROBE_SOURCE = String.raw`
const { Worker } = require("node:worker_threads");
const marker = ${JSON.stringify(NODE_DEBUGGER_RUNTIME_PROBE_MARKER)};
const worker = new Worker(${JSON.stringify(WORKER_SOURCE)}, { eval: true });
const timer = setTimeout(() => {
  process.stderr.write("node debugger runtime probe timed out");
  process.exitCode = 70;
  void worker.terminate();
}, 1500);
worker.once("error", (error) => {
  clearTimeout(timer);
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exitCode = 71;
});
worker.once("message", (message) => {
  clearTimeout(timer);
  if (message !== "ready") {
    process.stderr.write("node debugger runtime probe returned invalid data");
    process.exitCode = 72;
  } else {
    process.stdout.write(JSON.stringify({ marker, nodeVersion: process.versions.node }));
  }
  void worker.terminate();
});
`;

export const NODE_DEBUGGER_RUNTIME_PROBE_ARGUMENTS = [
  "-e",
  NODE_DEBUGGER_RUNTIME_PROBE_SOURCE,
] as const;
