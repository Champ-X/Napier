import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import {
  jsonText,
  sha256Text,
  verifyArtifacts,
} from "./sdk-capability-parity-evidence.mjs";

const EVIDENCE_DIRECTORY = path.resolve(
  "docs/artifacts/sdk-capability-parity-stage7",
);
const ZERO_DIGEST = "0".repeat(64);

describe("SDK capability parity evidence verifier", () => {
  test("accepts the captured evidence", async () => {
    await verifyArtifacts(EVIDENCE_DIRECTORY);
  });

  test.each([
    ["failed formal command", failFormalCommand],
    ["credential-reference match", addCredentialReferenceMatch],
    ["current source identity mismatch", changeSourceIdentity],
    ["external example identity drift", changeExampleIdentity],
    ["omitted identity entry", removeIdentityEntry],
    ["custom Agent linkage mismatch", breakCustomAgentLink],
    ["four-state digest continuity mismatch", breakDigestContinuity],
    ["production output overflow", exceedProductionOutputBound],
    ["built server entry mismatch", changeServerEntryIdentity],
    ["unexpected evidence key", addUnexpectedEvidenceKey],
    ["missing evidence key", removeRequiredEvidenceKey],
  ])("rejects %s", async (_name, tamper) => {
    await withArtifactCopy(async (directory) => {
      await tamper(directory);
      await expect(verifyArtifacts(directory)).rejects.toThrow();
    });
  });
});

async function withArtifactCopy(run) {
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-sdk-capability-evidence-test-"),
  );
  const directory = path.join(root, "artifacts");
  try {
    await cp(EVIDENCE_DIRECTORY, directory, { recursive: true });
    await run(directory);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function failFormalCommand(directory) {
  await updateJson(directory, "evidence.json", (evidence) => {
    evidence.formalCommands[0].exitCode = 1;
  });
}

async function addCredentialReferenceMatch(directory) {
  await updateJson(directory, "evidence.json", (evidence) => {
    evidence.credentialReferenceCanary.matchCount = 1;
  });
}

async function changeSourceIdentity(directory) {
  await updateJson(directory, "evidence.json", (evidence) => {
    evidence.sourceIdentity.files["packages/sdk/dist/management.js"] =
      ZERO_DIGEST;
  });
}

async function changeExampleIdentity(directory) {
  await updateJson(directory, "evidence.json", (evidence) => {
    evidence.sourceIdentity.files[
      "packages/sdk/examples/effective-capabilities.mjs"
    ] = ZERO_DIGEST;
  });
}

async function removeIdentityEntry(directory) {
  await updateJson(directory, "evidence.json", (evidence) => {
    delete evidence.sourceIdentity.files[
      "packages/sdk/examples/effective-capabilities.mjs"
    ];
    delete evidence.sourceIdentity.lineCounts[
      "packages/sdk/examples/effective-capabilities.mjs"
    ];
  });
}

async function breakCustomAgentLink(directory) {
  await updateLinkedReceipt(directory, "four-state-parity.json", (receipt) => {
    receipt.setupBoundaries[2].importedAgentId = `agent_${"0".repeat(20)}`;
  });
}

async function breakDigestContinuity(directory) {
  await updateLinkedReceipt(directory, "four-state-parity.json", (receipt) => {
    receipt.setupBoundaries[1].before.rawWorkspaceSha256 = ZERO_DIGEST;
  });
}

async function exceedProductionOutputBound(directory) {
  await updateLinkedReceipt(
    directory,
    "production-server-trace.json",
    (receipt) => {
      receipt.child.stdoutBytes = receipt.child.maximumOutputBytes + 1;
      receipt.child.stderrBytes = 0;
      receipt.child.totalOutputBytes = receipt.child.stdoutBytes;
    },
  );
}

async function changeServerEntryIdentity(directory) {
  await updateLinkedReceipt(
    directory,
    "production-server-trace.json",
    (receipt) => {
      receipt.serverEntrySha256 = ZERO_DIGEST;
    },
  );
}

async function addUnexpectedEvidenceKey(directory) {
  await updateJson(directory, "evidence.json", (evidence) => {
    evidence.unexpected = true;
  });
}

async function removeRequiredEvidenceKey(directory) {
  await updateJson(directory, "evidence.json", (evidence) => {
    delete evidence.result;
  });
}

async function updateLinkedReceipt(directory, file, mutate) {
  const text = await updateJson(directory, file, mutate);
  await updateJson(directory, "evidence.json", (evidence) => {
    if (file === "four-state-parity.json") {
      evidence.artifacts.fourStateParity.sha256 = sha256Text(text);
      evidence.formalCommands[0].evidenceSha256 = sha256Text(text);
    } else {
      evidence.artifacts.productionServerTrace.sha256 = sha256Text(text);
      evidence.formalCommands[1].evidenceSha256 = sha256Text(text);
    }
  });
}

async function updateJson(directory, file, mutate) {
  const target = path.join(directory, file);
  const value = JSON.parse(await readFile(target, "utf8"));
  mutate(value);
  const text = jsonText(value);
  await writeFile(target, text);
  return text;
}
