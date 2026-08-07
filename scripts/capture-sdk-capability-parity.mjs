import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { runFourStateCapabilityParity } from "./agent-capability-parity-harness.mjs";
import {
  captureEvidenceIdentity,
  createEvidence,
  FORMAL_COMMANDS,
  jsonText,
  sha256Text,
  verifyArtifacts,
} from "./sdk-capability-parity-evidence.mjs";
import { CAPTURE_OUTPUT_PATHS } from "./sdk-capability-parity-identity.mjs";
import { runBoundProductionServerTrace } from "./sdk-capability-production-server-harness.mjs";

const execFileAsync = promisify(execFile);
const { outputDir, mode } = parseArguments(process.argv.slice(2));

if (mode !== "capture") {
  await verifyArtifacts(outputDir, {
    verifyCurrent: mode === "verify-current",
  });
  process.stdout.write(
    `Verified SDK capability parity evidence: ${outputDir}\n`,
  );
} else {
  await captureArtifacts(outputDir);
  process.stdout.write(
    `Captured SDK capability parity evidence: ${outputDir}\n`,
  );
}

async function captureArtifacts(target) {
  const commandObservations = [];
  commandObservations.push(
    await observeCommand(FORMAL_COMMANDS[0], [
      "exec",
      "--",
      "vitest",
      "run",
      "scripts/agent-capability-projection-equality.test.mjs",
    ]),
  );
  commandObservations.push(
    await observeCommand(FORMAL_COMMANDS[1], [
      "exec",
      "--",
      "vitest",
      "run",
      "scripts/sdk-capability-production-server.test.mjs",
    ]),
  );
  const canaryObservation = await observeCommand(
    FORMAL_COMMANDS[2],
    ["--import", "tsx", "scripts/run-credential-reference-canary.ts"],
    process.execPath,
  );
  commandObservations.push(canaryObservation);
  const canary = JSON.parse(canaryObservation.stdout.trim());
  assert.deepEqual(canary, { status: "pass", matchCount: 0 });

  const [fourStateParity, productionServerTrace] = await Promise.all([
    runFourStateCapabilityParity(),
    runBoundProductionServerTrace(),
  ]);
  const readme = readmeText();
  const fourStateText = jsonText(fourStateParity);
  const productionTraceText = jsonText(productionServerTrace);
  const contentOverrides = new Map([
    [CAPTURE_OUTPUT_PATHS[0], readme],
    [CAPTURE_OUTPUT_PATHS[2], fourStateText],
    [CAPTURE_OUTPUT_PATHS[3], productionTraceText],
  ]);
  const identity = await captureEvidenceIdentity({ contentOverrides });
  const evidence = createEvidence({
    readme,
    fourStateText,
    productionTraceText,
    formalCommands: commandObservations.map(({ receipt }) => receipt),
    canary,
    identity,
    fourStateParity,
    productionServerTrace,
  });
  await mkdir(target, { recursive: true });
  await Promise.all([
    writeFile(path.join(target, "README.md"), readme),
    writeFile(path.join(target, "four-state-parity.json"), fourStateText),
    writeFile(
      path.join(target, "production-server-trace.json"),
      productionTraceText,
    ),
    writeFile(path.join(target, "evidence.json"), jsonText(evidence)),
  ]);
  await verifyArtifacts(target, { verifyCurrent: true });
}

async function observeCommand(contract, arguments_, executable = "npm") {
  const { stdout, stderr } = await execFileAsync(executable, arguments_, {
    cwd: process.cwd(),
    env: commandEnvironment(),
    timeout: 45_000,
    killSignal: "SIGTERM",
    maxBuffer: 1024 * 1024,
  });
  return {
    stdout,
    receipt: {
      id: contract.id,
      command: contract.command,
      exitCode: 0,
      stdoutSha256: sha256Text(stdout),
      stderrSha256: sha256Text(stderr),
    },
  };
}

function readmeText() {
  return `# SDK capability parity — Stage 8 repaired evidence

This directory proves the bounded addition of a stateless, GET-only
\`@napier/sdk/management\` client for the existing effective-Agent capability
projection. It does not add SDK mutation, setup, doctor, sandbox, skill-loading,
deployment, or live-model behavior. This slice does not complete overall M0, and
M1–M5 remain out of scope.

The receipts are sanitized and offline. No raw Store contents, response bodies,
absolute temporary paths, child output, generated secret, credential value, or
environment value is retained.

- \`four-state-parity.json\`: built CLI, real HTTP route, and built SDK equality for
  stale, current, custom-unmanaged, and broken projections, including before/after
  Store and event-manifest digests.
- \`production-server-trace.json\`: a bounded loopback trace through the actual built
  server entry and the external SDK example using global \`fetch\`.
- \`evidence.json\`: causally observed formal-command exits, immutable implementation
  Git blobs, deterministic execution closures, exact repair content, historical gate
  and review receipts, artifact links, and cleanup receipts.

Capture after building Contracts, Runtime, CLI, SDK, and Server:

\`\`\`sh
node scripts/capture-sdk-capability-parity.mjs --output-dir docs/artifacts/sdk-capability-parity-stage7
\`\`\`

Capture executes these formal commands and records their bounded output digests:

\`\`\`sh
npm exec -- vitest run scripts/agent-capability-projection-equality.test.mjs
npm exec -- vitest run scripts/sdk-capability-production-server.test.mjs
node --import tsx scripts/run-credential-reference-canary.ts
\`\`\`

Ordinary verification checks immutable implementation objects and recorded repair
content without coupling the evidence to the current HEAD. It does not start a
server or change artifacts:

\`\`\`sh
node scripts/capture-sdk-capability-parity.mjs --output-dir docs/artifacts/sdk-capability-parity-stage7 --verify
\`\`\`

The stricter capture-snapshot mode additionally requires the exact Stage 8 repair
path set relative to the implementation commit:

\`\`\`sh
node scripts/capture-sdk-capability-parity.mjs --output-dir docs/artifacts/sdk-capability-parity-stage7 --verify-current
\`\`\`

The immutable implementation commit is
\`d81f77b64998fd786aa7a514f53494adb255e1e5\`; rollback is
\`git revert d81f77b64998fd786aa7a514f53494adb255e1e5\`. The containing
Stage 8 repair commit binds \`evidence.json\` and is recorded by the external Stage
8 acceptance output after final review. The implementation is additive and has no
persistent schema migration. Never reset or clean protected user files.
`;
}

function parseArguments(arguments_) {
  let outputDir;
  let mode = "capture";
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--verify") {
      assert.equal(mode, "capture", "verification mode may be supplied once");
      mode = "verify";
    } else if (argument === "--verify-current") {
      assert.equal(mode, "capture", "verification mode may be supplied once");
      mode = "verify-current";
    } else if (argument === "--output-dir") {
      assert.equal(
        outputDir,
        undefined,
        "--output-dir may be supplied only once",
      );
      const value = arguments_[index + 1];
      assert.ok(value && !value.startsWith("--"), "--output-dir needs a value");
      outputDir = path.resolve(value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  assert.ok(outputDir, "--output-dir is required");
  return { outputDir, mode };
}

function commandEnvironment() {
  return {
    LANG: "C",
    PATH: process.env.PATH ?? "",
    TMPDIR: process.env.TMPDIR ?? "/tmp",
    TZ: "UTC",
  };
}
