import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  EXTERNAL_PUBLICATION_IMAGE as IMAGE,
  EXTERNAL_PUBLICATION_PLATFORMS as PLATFORMS,
  EXTERNAL_PUBLICATION_PREDICATE_TYPE as PREDICATE_TYPE,
  EXTERNAL_PUBLICATION_WORKFLOW as WORKFLOW,
  canonicalJson,
  externalPublicationInput,
  isRecord as record,
  sha256,
  validateExternalPublicationReceipt,
} from "./sandbox-external-publication-model.mjs";
const FILES = {
  remoteIndex: "remote-index.json",
  buildkitPredicates: "buildkit-attestation-predicates.jsonl",
  anonymousPlatforms: "anonymous-platforms.jsonl",
  cosignBundle: "cosign.bundle.json",
  cosignVerification: "cosign.verify.json",
  attestationPredicate: "slsa-provenance-v1.json",
  attestationBundle: "cosign-attestation.bundle.json",
  attestationVerification: "cosign-attestation.verify.json",
};

export async function writeSandboxExternalPublicationReceipt(
  evidenceDir,
  environment = process.env,
) {
  const input = externalPublicationInput(environment);
  const evidence = await inspectEvidence(evidenceDir, input);
  const withoutHash = {
    kind: "napier.sandbox-external-publication",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    repository: input.repository,
    workflow: WORKFLOW,
    workflowRunId: input.workflowRunId,
    workflowRunAttempt: input.workflowRunAttempt,
    sourceSha: input.sourceSha,
    image: IMAGE,
    version: input.version,
    digest: input.digest,
    platforms: PLATFORMS,
    contextSha256: input.contextSha256,
    remoteIndex: evidence.remoteIndex,
    buildkitAttestations: evidence.buildkitAttestations,
    anonymousPullAndExecution: true,
    anonymousPlatforms: evidence.anonymousPlatforms,
    cosign: {
      algorithm: "keyless-oidc",
      verified: true,
      transparencyLogVerified: true,
      ...evidence.cosign,
    },
    externalAttestation: {
      predicateType: PREDICATE_TYPE,
      verified: true,
      registryStored: true,
      transparencyLogVerified: true,
      ...evidence.externalAttestation,
    },
    retention: {
      credentialValues: false,
      rawWorkflowLog: false,
      rawDockerOutput: false,
      imageBytes: false,
      workspacePaths: false,
    },
    scope: {
      externalRegistryPublished: true,
      releaseSigningIdentity: true,
      transparencyLogRecorded: true,
      externalAttestation: true,
      windowsHostProductAcceptance: false,
      s1Complete: false,
    },
  };
  const receipt = {
    ...withoutHash,
    contentSha256: sha256(canonicalJson(withoutHash)),
  };
  await writeFile(
    path.join(evidenceDir, "external-publication-receipt.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  return receipt;
}

export async function verifySandboxExternalPublicationEvidence(evidenceDir) {
  const receiptPath = path.join(
    evidenceDir,
    "external-publication-receipt.json",
  );
  const receipt = await readJson(receiptPath);
  const errors = validateExternalPublicationReceipt(receipt);
  if (errors.length === 0) {
    const expected = await inspectEvidence(evidenceDir, {
      digest: receipt.digest,
      contextSha256: receipt.contextSha256,
      sourceSha: receipt.sourceSha,
    }).catch(() => undefined);
    if (
      !expected ||
      canonicalJson(receipt.remoteIndex) !==
        canonicalJson(expected.remoteIndex) ||
      canonicalJson(receipt.buildkitAttestations) !==
        canonicalJson(expected.buildkitAttestations) ||
      canonicalJson(receipt.anonymousPlatforms) !==
        canonicalJson(expected.anonymousPlatforms) ||
      canonicalJson(receipt.cosign) !==
        canonicalJson({
          algorithm: "keyless-oidc",
          verified: true,
          transparencyLogVerified: true,
          ...expected.cosign,
        }) ||
      canonicalJson(receipt.externalAttestation) !==
        canonicalJson({
          predicateType: PREDICATE_TYPE,
          verified: true,
          registryStored: true,
          transparencyLogVerified: true,
          ...expected.externalAttestation,
        })
    ) {
      errors.push("external publication evidence does not match its files");
    }
  }
  return {
    valid: errors.length === 0,
    errors,
    path: receiptPath,
    sha256: sha256(await readFile(receiptPath)),
  };
}

async function inspectEvidence(evidenceDir, input) {
  const values = Object.fromEntries(
    await Promise.all(
      Object.entries(FILES).map(async ([name, fileName]) => {
        const filePath = path.join(evidenceDir, fileName);
        return [name, await readFile(filePath)];
      }),
    ),
  );
  const remoteIndex = JSON.parse(values.remoteIndex.toString("utf8"));
  const remoteIndexDigest = `sha256:${sha256(values.remoteIndex)}`;
  const descriptors = Array.isArray(remoteIndex.manifests)
    ? remoteIndex.manifests
    : [];
  const platforms = descriptors
    .filter(
      (descriptor) =>
        descriptor?.platform?.os === "linux" &&
        ["amd64", "arm64"].includes(descriptor.platform.architecture),
    )
    .map(
      (descriptor) =>
        `${descriptor.platform.os}/${descriptor.platform.architecture}`,
    )
    .sort();
  const attestationCount = descriptors.filter(
    (descriptor) =>
      descriptor?.platform?.os === "unknown" &&
      descriptor?.platform?.architecture === "unknown",
  ).length;
  if (
    remoteIndex.schemaVersion !== 2 ||
    remoteIndexDigest !== input.digest ||
    platforms.join("\n") !== PLATFORMS.join("\n") ||
    descriptors.length !== platforms.length + attestationCount ||
    attestationCount < 2
  ) {
    throw new Error("remote OCI index evidence is invalid");
  }
  const anonymousPlatforms = values.anonymousPlatforms
    .toString("utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .sort((left, right) => left.platform.localeCompare(right.platform));
  if (
    anonymousPlatforms.length !== PLATFORMS.length ||
    anonymousPlatforms.map((item) => item.platform).join("\n") !==
      PLATFORMS.join("\n") ||
    anonymousPlatforms.some(
      (item) =>
        item.anonymousPull !== true ||
        item.executed !== true ||
        item.contextSha256 !== input.contextSha256 ||
        item.sourceSha !== input.sourceSha ||
        item.nodeVersion !== "v24.16.0",
    )
  ) {
    throw new Error("anonymous platform evidence is invalid");
  }
  const buildkitPredicates = values.buildkitPredicates
    .toString("utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .sort();
  if (
    !buildkitPredicates.includes("https://spdx.dev/Document") ||
    !buildkitPredicates.some(
      (predicate) =>
        typeof predicate === "string" &&
        predicate.startsWith("https://slsa.dev/provenance/"),
    )
  ) {
    throw new Error("BuildKit attestation evidence is invalid");
  }
  const cosignBundle = JSON.parse(values.cosignBundle.toString("utf8"));
  if (
    !Array.isArray(cosignBundle?.verificationMaterial?.tlogEntries) ||
    cosignBundle.verificationMaterial.tlogEntries.length < 1
  ) {
    throw new Error("Cosign transparency evidence is invalid");
  }
  const cosignVerification = JSON.parse(
    values.cosignVerification.toString("utf8"),
  );
  const cosignEntries = Array.isArray(cosignVerification)
    ? cosignVerification
    : [cosignVerification];
  if (
    cosignEntries.length === 0 ||
    cosignEntries.some(
      (entry) =>
        entry?.critical?.image?.["docker-manifest-digest"] !== input.digest ||
        entry?.optional?.["source-sha"] !== input.sourceSha,
    )
  ) {
    throw new Error("Cosign verification evidence is invalid");
  }
  const attestationPredicate = JSON.parse(
    values.attestationPredicate.toString("utf8"),
  );
  if (
    attestationPredicate?.buildDefinition?.buildType !==
      "https://napier.local/github-actions/sandbox-oci/v1" ||
    attestationPredicate?.buildDefinition?.externalParameters?.repository !==
      "Champ-X/Napier" ||
    attestationPredicate?.buildDefinition?.externalParameters?.sourceSha !==
      input.sourceSha ||
    attestationPredicate?.buildDefinition?.externalParameters?.contextSha256 !==
      input.contextSha256 ||
    attestationPredicate?.buildDefinition?.externalParameters?.platforms?.join(
      "\n",
    ) !== PLATFORMS.join("\n") ||
    attestationPredicate?.buildDefinition?.internalParameters?.workflow !==
      WORKFLOW ||
    attestationPredicate?.buildDefinition?.internalParameters?.releaseGate !==
      "npm run check"
  ) {
    throw new Error("external SLSA predicate is invalid");
  }
  const attestationBundle = JSON.parse(
    values.attestationBundle.toString("utf8"),
  );
  if (
    !Array.isArray(attestationBundle?.verificationMaterial?.tlogEntries) ||
    attestationBundle.verificationMaterial.tlogEntries.length < 1
  ) {
    throw new Error("external attestation transparency evidence is invalid");
  }
  const attestationVerification = JSON.parse(
    values.attestationVerification.toString("utf8"),
  );
  const attestationEntries = Array.isArray(attestationVerification)
    ? attestationVerification
    : [attestationVerification];
  if (
    attestationEntries.length < 1 ||
    attestationEntries.some((entry) => {
      let statement;
      try {
        statement = JSON.parse(
          Buffer.from(entry?.payload ?? "", "base64").toString("utf8"),
        );
      } catch {
        return true;
      }
      return (
        statement?._type !== "https://in-toto.io/Statement/v1" ||
        statement?.predicateType !== PREDICATE_TYPE ||
        !Array.isArray(statement.subject) ||
        statement.subject.length !== 1 ||
        statement.subject[0]?.name !== IMAGE ||
        statement.subject[0]?.digest?.sha256 !==
          input.digest.slice("sha256:".length) ||
        canonicalJson(statement.predicate) !==
          canonicalJson(attestationPredicate)
      );
    })
  ) {
    throw new Error("external attestation verification is invalid");
  }
  return {
    remoteIndex: {
      sha256: sha256(values.remoteIndex),
      byteCount: values.remoteIndex.byteLength,
      attestationDescriptorCount: attestationCount,
    },
    buildkitAttestations: {
      sha256: sha256(values.buildkitPredicates),
      predicateCount: buildkitPredicates.length,
      sbomPredicateVerified: true,
      provenancePredicateVerified: true,
    },
    anonymousPlatforms: {
      sha256: sha256(values.anonymousPlatforms),
      platformCount: anonymousPlatforms.length,
    },
    cosign: {
      bundleSha256: sha256(values.cosignBundle),
      verificationSha256: sha256(values.cosignVerification),
      transparencyEntryCount:
        cosignBundle.verificationMaterial.tlogEntries.length,
    },
    externalAttestation: {
      predicateSha256: sha256(values.attestationPredicate),
      bundleSha256: sha256(values.attestationBundle),
      verificationSha256: sha256(values.attestationVerification),
      verificationCount: attestationEntries.length,
      transparencyEntryCount:
        attestationBundle.verificationMaterial.tlogEntries.length,
    },
  };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}
