import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const IDENTITY_FILES = [
  "packages/contracts/package.json",
  "packages/contracts/src/agent-capability-contract.ts",
  "packages/contracts/src/management-http.ts",
  "packages/contracts/dist/agent-capability-contract.js",
  "packages/contracts/dist/management-http.js",
  "packages/sdk/package.json",
  "packages/sdk/src/index.ts",
  "packages/sdk/src/management.ts",
  "packages/sdk/src/management-client.ts",
  "packages/sdk/src/management-client-error.ts",
  "packages/sdk/dist/index.js",
  "packages/sdk/dist/management.js",
  "packages/sdk/dist/management-client.js",
  "packages/sdk/dist/management-client-error.js",
  "packages/sdk/examples/effective-capabilities.mjs",
  "packages/runtime/src/index.ts",
  "packages/runtime/src/local-agent-runtime.ts",
  "packages/runtime/src/agent-capability-service.ts",
  "packages/runtime/src/agent-capability-bindings.ts",
  "packages/runtime/src/agent-capability-store-state.ts",
  "packages/runtime/src/agent-capability-store-mutations.ts",
  "packages/runtime/src/default-agent-capability-contract.ts",
  "packages/runtime/dist/index.js",
  "packages/runtime/dist/local-agent-runtime.js",
  "packages/runtime/dist/agent-capability-service.js",
  "packages/runtime/dist/agent-capability-bindings.js",
  "packages/runtime/dist/agent-capability-store-state.js",
  "packages/runtime/dist/agent-capability-store-mutations.js",
  "packages/runtime/dist/default-agent-capability-contract.js",
  "packages/runtime/test/fixtures/capability-contract-v1/pre-search/manifest.json",
  "packages/runtime/test/fixtures/capability-contract-v1/pre-search/workspace.json",
  "packages/runtime/test/fixtures/capability-contract-v1/pre-search/events/thread_d1872b201aa24d8a84f4.jsonl",
  "apps/server/src/index.ts",
  "apps/server/src/app.ts",
  "apps/server/src/agent-capability-http.ts",
  "apps/server/src/http-response-evidence.ts",
  "apps/server/dist/index.js",
  "apps/server/dist/app.js",
  "apps/server/dist/agent-capability-http.js",
  "apps/server/dist/http-response-evidence.js",
  "apps/cli/src/cli.ts",
  "apps/cli/src/cli-options.ts",
  "apps/cli/src/cli-command-options.ts",
  "apps/cli/src/cli-capability-options.ts",
  "apps/cli/src/cli-first-use.ts",
  "apps/cli/src/capability-cli.ts",
  "apps/cli/dist/cli.js",
  "apps/cli/dist/cli-options.js",
  "apps/cli/dist/cli-command-options.js",
  "apps/cli/dist/cli-capability-options.js",
  "apps/cli/dist/cli-first-use.js",
  "apps/cli/dist/capability-cli.js",
  "scripts/agent-capability-projection-equality.test.mjs",
  "scripts/agent-capability-parity-harness.mjs",
  "scripts/sdk-capability-production-server.test.mjs",
  "scripts/sdk-capability-production-server-harness.mjs",
  "scripts/sdk-capability-production-process.mjs",
  "scripts/sdk-capability-production-process.test.mjs",
  "scripts/capture-sdk-capability-parity.mjs",
  "scripts/sdk-capability-parity-evidence.mjs",
  "scripts/sdk-capability-parity-evidence.test.mjs",
  "scripts/sdk-capability-parity-identity.mjs",
  "scripts/sdk-capability-parity-receipts.mjs",
  "scripts/run-credential-reference-canary.ts",
];

export const LINE_BUDGET_FILES = new Set([
  "packages/contracts/src/agent-capability-contract.ts",
  "packages/contracts/src/management-http.ts",
  "packages/sdk/src/management.ts",
  "packages/sdk/src/management-client.ts",
  "packages/sdk/src/management-client-error.ts",
  "packages/sdk/examples/effective-capabilities.mjs",
  "scripts/agent-capability-projection-equality.test.mjs",
  "scripts/agent-capability-parity-harness.mjs",
  "scripts/sdk-capability-production-server.test.mjs",
  "scripts/sdk-capability-production-server-harness.mjs",
  "scripts/sdk-capability-production-process.mjs",
  "scripts/sdk-capability-production-process.test.mjs",
  "scripts/capture-sdk-capability-parity.mjs",
  "scripts/sdk-capability-parity-evidence.mjs",
  "scripts/sdk-capability-parity-evidence.test.mjs",
  "scripts/sdk-capability-parity-identity.mjs",
  "scripts/sdk-capability-parity-receipts.mjs",
]);

export async function captureCurrentIdentity() {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    env: commandEnvironment(),
    timeout: 5_000,
    maxBuffer: 16 * 1024,
  });
  const files = {};
  const lineCounts = {};
  for (const relative of IDENTITY_FILES) {
    const bytes = await readFile(path.resolve(relative));
    files[relative] = sha256Bytes(bytes);
    lineCounts[relative] = lineCount(bytes.toString("utf8"));
  }
  return { schemaVersion: 1, head: stdout.trim(), files, lineCounts };
}

function lineCount(value) {
  if (value.length === 0) return 0;
  return value.split("\n").length - (value.endsWith("\n") ? 1 : 0);
}

function commandEnvironment() {
  return {
    LANG: "C",
    PATH: process.env.PATH ?? "",
    TMPDIR: process.env.TMPDIR ?? "/tmp",
    TZ: "UTC",
  };
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}
