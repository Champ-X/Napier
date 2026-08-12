import { readFile } from "node:fs/promises";
import path from "node:path";

import { verifyLinuxHostProductAcceptance } from "./check-linux-host-product-acceptance.mjs";
import { verifyOciCrashRecoveryArtifact } from "./check-oci-crash-recovery.mjs";
import { verifyOciResourceLimitsEvidence } from "./check-oci-resource-limits.mjs";
import { verifyProfileUpgrade } from "./check-profile-upgrade.mjs";
import { verifySandboxAcquisition } from "./check-sandbox-acquisition.mjs";
import { verifySandboxImageArtifacts } from "./check-sandbox-image-sbom.mjs";
import { verifySandboxMultiArchitecture } from "./check-sandbox-multi-architecture.mjs";
import { verifySandboxOciSupplyChain } from "./check-sandbox-oci-supply-chain.mjs";
import { verifySandboxPortableDap } from "./check-sandbox-portable-dap.mjs";
import { verifySandboxPortableLsp } from "./check-sandbox-portable-lsp.mjs";
import { verifySandboxPortableProcess } from "./check-sandbox-portable-process.mjs";
import { verifySandboxProductAcceptance } from "./check-sandbox-product-acceptance.mjs";
import { verifySandboxSecurityCasebook } from "./check-sandbox-security-casebook.mjs";
import { S1_REQUIREMENT_GROUPS } from "./s1-shell-sandbox-completion-artifact.mjs";
import { sha256 } from "./sandbox-external-publication-model.mjs";

const EVIDENCE_VERIFIERS = {
  "sandbox-image-sbom": "scripts/check-sandbox-image-sbom.mjs",
  "sandbox-image-provenance": "scripts/check-sandbox-image-sbom.mjs",
  "oci-resource-limits-stage10": "scripts/check-oci-resource-limits.mjs",
  "oci-crash-recovery-stage11": "scripts/check-oci-crash-recovery.mjs",
  "sandbox-security-casebook-stage12":
    "scripts/check-sandbox-security-casebook.mjs",
  "sandbox-product-acceptance-stage13":
    "scripts/check-sandbox-product-acceptance.mjs",
  "sandbox-multi-architecture-stage14":
    "scripts/check-sandbox-multi-architecture.mjs",
  "sandbox-portable-process-stage15":
    "scripts/check-sandbox-portable-process.mjs",
  "sandbox-portable-lsp-stage16": "scripts/check-sandbox-portable-lsp.mjs",
  "sandbox-portable-dap-stage17": "scripts/check-sandbox-portable-dap.mjs",
  "sandbox-oci-supply-chain-stage18":
    "scripts/check-sandbox-oci-supply-chain.mjs",
  "linux-host-product-acceptance-stage19":
    "scripts/check-linux-host-product-acceptance.mjs",
  "sandbox-acquisition-stage20": "scripts/check-sandbox-acquisition.mjs",
  "profile-upgrade-stage21": "scripts/check-profile-upgrade.mjs",
};

export async function collectS1LocalRequirements(options) {
  const repoRoot = path.resolve(options.repoRoot);
  const verifierHashes = Object.fromEntries(
    await Promise.all(
      Object.entries(EVIDENCE_VERIFIERS).map(async ([kind, relative]) => [
        kind,
        sha256(await readFile(path.join(repoRoot, relative))),
      ]),
    ),
  );
  const [
    image,
    resourceLimits,
    crashRecovery,
    security,
    product,
    multiArchitecture,
    portableProcess,
    portableLsp,
    portableDap,
    supplyChain,
    linuxHost,
    acquisition,
    profileUpgrade,
  ] = await Promise.all([
    verifySandboxImageArtifacts({ repoRoot }),
    verifyOciResourceLimitsEvidence({ repoRoot }),
    verifyOciCrashRecoveryArtifact({ repoRoot }),
    verifySandboxSecurityCasebook({ repoRoot }),
    verifySandboxProductAcceptance({ repoRoot }),
    verifySandboxMultiArchitecture({ repoRoot }),
    verifySandboxPortableProcess({ repoRoot }),
    verifySandboxPortableLsp({ repoRoot }),
    verifySandboxPortableDap({ repoRoot }),
    verifySandboxOciSupplyChain({ repoRoot }),
    verifyLinuxHostProductAcceptance({ repoRoot }),
    verifySandboxAcquisition({ repoRoot }),
    verifyProfileUpgrade({ repoRoot }),
  ]);
  const verified = {
    "sandbox-image-sbom": evidenceFromImage(image, "sbom"),
    "sandbox-image-provenance": evidenceFromImage(image, "receipt"),
    "oci-resource-limits-stage10": await evidenceFromResourceLimits(
      repoRoot,
      resourceLimits,
    ),
    "oci-crash-recovery-stage11": evidenceFromResult(
      crashRecovery,
      "OCI crash recovery",
    ),
    "sandbox-security-casebook-stage12": evidenceFromResult(
      security,
      "Sandbox security Casebook",
    ),
    "sandbox-product-acceptance-stage13": evidenceFromResult(
      product,
      "Sandbox product acceptance",
    ),
    "sandbox-multi-architecture-stage14": evidenceFromResult(
      multiArchitecture,
      "Sandbox multi-architecture",
    ),
    "sandbox-portable-process-stage15": evidenceFromResult(
      portableProcess,
      "Sandbox portable process",
    ),
    "sandbox-portable-lsp-stage16": evidenceFromResult(
      portableLsp,
      "Sandbox portable LSP",
    ),
    "sandbox-portable-dap-stage17": evidenceFromResult(
      portableDap,
      "Sandbox portable DAP",
    ),
    "sandbox-oci-supply-chain-stage18": evidenceFromResult(
      supplyChain,
      "Sandbox OCI supply chain",
    ),
    "linux-host-product-acceptance-stage19": evidenceFromResult(
      linuxHost,
      "Linux host product acceptance",
    ),
    "sandbox-acquisition-stage20": evidenceFromResult(
      acquisition,
      "Sandbox acquisition",
    ),
    "profile-upgrade-stage21": evidenceFromResult(
      profileUpgrade,
      "Profile upgrade",
    ),
  };
  return S1_REQUIREMENT_GROUPS.map((group) => ({
    id: group.id,
    status: "verified",
    evidence: group.evidenceKinds.map((kind) => ({
      kind,
      ...verified[kind],
      verifierSha256: verifierHashes[kind],
    })),
  }));
}

function evidenceFromImage(result, field) {
  if (!result.valid) {
    throw new Error(
      `Sandbox image evidence failed: ${result.errors.join("; ")}`,
    );
  }
  if (field === "sbom") {
    return { path: result.sbomPath, sha256: result.sbomSha256 };
  }
  return { path: result.receiptPath, sha256: result.receiptSha256 };
}

async function evidenceFromResourceLimits(repoRoot, result) {
  if (!result.valid) {
    throw new Error(`OCI resource limits failed: ${result.errors.join("; ")}`);
  }
  return {
    path: toRepoPath(repoRoot, result.artifactPath),
    sha256: sha256(await readFile(result.artifactPath)),
  };
}

function evidenceFromResult(result, label) {
  if (!result.valid) {
    throw new Error(`${label} failed: ${result.errors.join("; ")}`);
  }
  return { path: result.path, sha256: result.sha256 };
}

function toRepoPath(repoRoot, absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join("/");
}
