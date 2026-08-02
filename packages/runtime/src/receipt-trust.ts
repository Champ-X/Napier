import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";

import {
  NAPIER_API_VERSION,
  type CreateReceiptTrustAnchorRequest,
  type EvaluationCasebook,
  type EvaluationCasebookQualificationReceipt,
  type EvaluationQualificationBaseline,
  type ReceiptTrustAnchor,
  type ReceiptTrustAnchorDirectory,
  type ReceiptTrustAnchorDirectoryEntry,
  type ReceiptTrustAnchorDirectoryMetadataReceipt,
  type ReceiptTrustAnchorDirectoryMetadataVerification,
  type ReceiptTrustAnchorDirectoryVerification,
  type ReceiptTrustAnchorDirectoryVerificationPolicy,
  type SignReceiptTrustAnchorDirectoryMetadataRequest,
  type TrustedReceipt,
  type TrustedReceiptEnvelope,
  type TrustedReceiptKind,
  type TrustedReceiptVerification,
} from "@napier/contracts";

import { validateEvaluationCasebookQualificationReceipt } from "./evaluation-casebook-qualification.js";
import { createId, nowIso } from "./ids.js";

export const MAX_RECEIPT_TRUST_ANCHORS = 32;
export const MAX_QUALIFICATION_BASELINES_PER_CASEBOOK = 20;
export const MAX_TRUSTED_RECEIPT_BYTES = 10 * 1024 * 1024 + 64 * 1024;

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ENVIRONMENT_NAME_PATTERN = /^[A-Z_][A-Z0-9_]{1,127}$/;
const RESOURCE_ID_PATTERN = /^[a-z][a-z0-9_]{2,80}$/;
const TRUSTED_RECEIPT_KINDS: TrustedReceiptKind[] = [
  "evaluation_gate",
  "casebook_qualification",
  "policy_retirement_proof_bundle",
  "receipt_trust_anchor_directory_metadata",
  "receipt_trust_anchor_directory_quorum_promotion",
  "receipt_trust_anchor_directory_quorum_activation_decision",
  "receipt_trust_anchor_directory_quorum_activation_selection_rotation_proposal",
  "receipt_trust_anchor_directory_quorum_activation_selection_rotation_proposal_subscription_approval",
  "receipt_trust_anchor_directory_quorum_activation_selection_rotation_proposal_subscription_approval_policy_review",
  "receipt_trust_anchor_directory_quorum_activation_selection_checkpoint",
  "receipt_trust_anchor_directory_quorum_activation_selection_checkpoint_registry_quorum",
];
const RECEIPT_TRUST_ANCHOR_DIRECTORY_KEYS = [
  "kind",
  "schemaVersion",
  "apiVersion",
  "generatedAt",
  "receiptKinds",
  "anchorCount",
  "trustedCount",
  "revokedCount",
  "anchorSetSha256",
  "anchors",
  "contentSha256",
];
const RECEIPT_TRUST_ANCHOR_DIRECTORY_ENTRY_KEYS = [
  "id",
  "label",
  "algorithm",
  "keyId",
  "publicKeySpki",
  "status",
  "createdAt",
  "updatedAt",
  "revokedAt",
  "anchorSha256",
];
const RECEIPT_TRUST_ANCHOR_DIRECTORY_VERIFICATION_POLICY_KEYS = [
  "maxAgeMs",
  "expectedAnchorSetSha256",
  "minimumTrustedCount",
  "requiredTrustedKeyIds",
];

interface ReceiptSignatureStatement {
  kind: "napier.receipt-signature-statement";
  schemaVersion: 1;
  apiVersion: string;
  receiptKind: TrustedReceiptKind;
  receiptContentSha256: string;
  receiptArtifactSha256: string;
  keyId: string;
  signedAt: string;
}

export interface ValidatedTrustedReceipt {
  receipt: TrustedReceipt;
  receiptKind: TrustedReceiptKind;
}

export type TrustedReceiptValidator = (
  value: unknown,
) => ValidatedTrustedReceipt;

export function createReceiptTrustAnchor(
  request: CreateReceiptTrustAnchorRequest,
  environment: NodeJS.ProcessEnv = process.env,
): ReceiptTrustAnchor {
  const label = normalizeLabel(request.label);
  const timestamp = nowIso();
  let publicKey: KeyObject;
  let signingSource: ReceiptTrustAnchor["signingSource"];
  if (request.source.type === "environment") {
    const variable = normalizeEnvironmentName(request.source.variable);
    const value = environment[variable];
    if (!value) {
      throw new Error(`Receipt signing key is unavailable: ${variable}`);
    }
    const privateKey = parsePrivateKey(value);
    publicKey = createPublicKey(privateKey);
    signingSource = { type: "environment", variable };
  } else {
    publicKey = parsePublicKeySpki(request.source.publicKeySpki);
  }
  assertEd25519Key(publicKey, "Receipt trust anchor");
  const publicKeySpki = exportPublicKeySpki(publicKey);
  const content = {
    id: createId("trustkey"),
    label,
    algorithm: "Ed25519" as const,
    keyId: hashPublicKeySpki(publicKeySpki),
    publicKeySpki,
    ...(signingSource ? { signingSource } : {}),
    status: "trusted" as const,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return {
    ...content,
    contentSha256: hashReceiptTrustAnchor(content),
  };
}

export function revokeReceiptTrustAnchor(
  anchor: ReceiptTrustAnchor,
): ReceiptTrustAnchor {
  const current = validateReceiptTrustAnchor(anchor);
  if (current.status === "revoked") return current;
  const timestamp = nowIso();
  const content = {
    ...current,
    status: "revoked" as const,
    updatedAt: timestamp,
    revokedAt: timestamp,
  };
  const { contentSha256: _contentSha256, ...hashInput } = content;
  return {
    ...content,
    contentSha256: hashReceiptTrustAnchor(hashInput),
  };
}

export function hashReceiptTrustAnchor(
  anchor: Omit<ReceiptTrustAnchor, "contentSha256">,
): string {
  return sha256(canonicalJson(anchor));
}

export function validateReceiptTrustAnchor(value: unknown): ReceiptTrustAnchor {
  if (!isRecord(value)) {
    throw new Error("Receipt trust anchor must be an object");
  }
  const anchor = value as unknown as ReceiptTrustAnchor;
  assertAllowedKeys(value, [
    "id",
    "label",
    "algorithm",
    "keyId",
    "publicKeySpki",
    "signingSource",
    "status",
    "createdAt",
    "updatedAt",
    "revokedAt",
    "contentSha256",
  ]);
  if (
    !RESOURCE_ID_PATTERN.test(anchor.id) ||
    normalizeLabel(anchor.label) !== anchor.label ||
    anchor.algorithm !== "Ed25519" ||
    !SHA256_PATTERN.test(anchor.keyId) ||
    (anchor.status !== "trusted" && anchor.status !== "revoked") ||
    !validTimestamp(anchor.createdAt) ||
    !validTimestamp(anchor.updatedAt) ||
    anchor.updatedAt < anchor.createdAt ||
    !SHA256_PATTERN.test(anchor.contentSha256)
  ) {
    throw new Error("Receipt trust anchor is invalid");
  }
  if (anchor.signingSource) {
    if (
      !isRecord(anchor.signingSource) ||
      Object.keys(anchor.signingSource).some(
        (key) => key !== "type" && key !== "variable",
      ) ||
      anchor.signingSource.type !== "environment" ||
      normalizeEnvironmentName(anchor.signingSource.variable) !==
        anchor.signingSource.variable
    ) {
      throw new Error("Receipt trust anchor signing source is invalid");
    }
  }
  if (
    (anchor.status === "revoked" && !validTimestamp(anchor.revokedAt)) ||
    (anchor.status === "trusted" && anchor.revokedAt !== undefined) ||
    (anchor.revokedAt !== undefined &&
      (anchor.revokedAt < anchor.createdAt ||
        anchor.revokedAt !== anchor.updatedAt))
  ) {
    throw new Error("Receipt trust anchor revocation evidence is invalid");
  }
  const publicKey = parsePublicKeySpki(anchor.publicKeySpki);
  assertEd25519Key(publicKey, "Receipt trust anchor");
  const normalizedSpki = exportPublicKeySpki(publicKey);
  if (
    normalizedSpki !== anchor.publicKeySpki ||
    hashPublicKeySpki(normalizedSpki) !== anchor.keyId
  ) {
    throw new Error("Receipt trust anchor key fingerprint mismatch");
  }
  const { contentSha256: _contentSha256, ...content } = anchor;
  if (hashReceiptTrustAnchor(content) !== anchor.contentSha256) {
    throw new Error("Receipt trust anchor content hash mismatch");
  }
  return structuredClone(anchor);
}

export function createReceiptTrustAnchorDirectory(
  anchors: ReceiptTrustAnchor[],
): ReceiptTrustAnchorDirectory {
  const entries = anchors
    .map(createReceiptTrustAnchorDirectoryEntry)
    .sort(compareReceiptTrustAnchorDirectoryEntries);
  const content = {
    kind: "napier.receipt-trust-anchor-directory" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    receiptKinds: TRUSTED_RECEIPT_KINDS,
    anchorCount: entries.length,
    trustedCount: entries.filter((entry) => entry.status === "trusted").length,
    revokedCount: entries.filter((entry) => entry.status === "revoked").length,
    anchorSetSha256: receiptTrustAnchorDirectoryAnchorSetSha256(entries),
    anchors: entries,
  };
  return {
    ...content,
    generatedAt: nowIso(),
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function validateReceiptTrustAnchorDirectory(
  value: unknown,
): ReceiptTrustAnchorDirectory {
  if (!isRecord(value)) {
    throw new Error("Receipt trust anchor directory must be an object");
  }
  assertAllowedKeys(value, RECEIPT_TRUST_ANCHOR_DIRECTORY_KEYS);
  const directory = value as unknown as ReceiptTrustAnchorDirectory;
  if (
    directory.kind !== "napier.receipt-trust-anchor-directory" ||
    directory.schemaVersion !== 1 ||
    directory.apiVersion !== NAPIER_API_VERSION ||
    !validTimestamp(directory.generatedAt) ||
    !validTrustedReceiptKinds(directory.receiptKinds) ||
    !nonNegativeInteger(directory.anchorCount) ||
    !nonNegativeInteger(directory.trustedCount) ||
    !nonNegativeInteger(directory.revokedCount) ||
    !SHA256_PATTERN.test(directory.anchorSetSha256) ||
    !Array.isArray(directory.anchors) ||
    directory.anchors.length !== directory.anchorCount ||
    !SHA256_PATTERN.test(directory.contentSha256)
  ) {
    throw new Error("Receipt trust anchor directory is invalid");
  }
  const anchors = directory.anchors
    .map(validateReceiptTrustAnchorDirectoryEntry)
    .sort(compareReceiptTrustAnchorDirectoryEntries);
  if (
    anchors.filter((anchor) => anchor.status === "trusted").length !==
      directory.trustedCount ||
    anchors.filter((anchor) => anchor.status === "revoked").length !==
      directory.revokedCount ||
    receiptTrustAnchorDirectoryAnchorSetSha256(anchors) !==
      directory.anchorSetSha256
  ) {
    throw new Error("Receipt trust anchor directory counts are invalid");
  }
  const {
    contentSha256: _contentSha256,
    generatedAt: _generatedAt,
    ...content
  } = {
    ...directory,
    anchors,
  };
  if (sha256(canonicalJson(content)) !== directory.contentSha256) {
    throw new Error("Receipt trust anchor directory content hash mismatch");
  }
  return structuredClone({
    ...directory,
    anchors,
  });
}

export function verifyReceiptTrustAnchorDirectory(
  input: unknown,
  policy?: ReceiptTrustAnchorDirectoryVerificationPolicy,
): ReceiptTrustAnchorDirectoryVerification {
  const verifiedAtMs = Date.now();
  const diagnostics: string[] = [];
  let normalizedPolicy:
    | ReceiptTrustAnchorDirectoryVerificationPolicy
    | undefined;
  let policySha256: string | undefined;
  try {
    normalizedPolicy =
      normalizeReceiptTrustAnchorDirectoryVerificationPolicy(policy);
    policySha256 = normalizedPolicy
      ? sha256(canonicalJson(normalizedPolicy))
      : undefined;
  } catch {
    diagnostics.push("policy_invalid");
  }
  const record = isRecord(input) ? input : undefined;
  if (!record) diagnostics.push("directory_not_object");
  const contentSha256Value = record?.["contentSha256"];
  const anchorSetSha256Value = record?.["anchorSetSha256"];
  const declaredContentSha256 = isSha256(contentSha256Value)
    ? contentSha256Value
    : undefined;
  const declaredAnchorSetSha256 = isSha256(anchorSetSha256Value)
    ? anchorSetSha256Value
    : undefined;
  const directoryGeneratedAt = validTimestamp(record?.["generatedAt"])
    ? record["generatedAt"]
    : undefined;
  const directoryAgeMs = directoryGeneratedAt
    ? verifiedAtMs - Date.parse(directoryGeneratedAt)
    : undefined;
  const recomputedContentSha256 = record
    ? sha256(canonicalJson(receiptTrustAnchorDirectoryHashContent(record)))
    : undefined;
  let anchors: ReceiptTrustAnchorDirectoryEntry[] | undefined;
  let recomputedAnchorSetSha256: string | undefined;
  let anchorCount: number | undefined;
  let trustedCount: number | undefined;
  let revokedCount: number | undefined;

  if (record?.["kind"] !== "napier.receipt-trust-anchor-directory") {
    diagnostics.push("kind_mismatch");
  }
  if (record?.["schemaVersion"] !== 1) diagnostics.push("schema_mismatch");
  if (record?.["apiVersion"] !== NAPIER_API_VERSION) {
    diagnostics.push("api_version_mismatch");
  }
  if (!validTimestamp(record?.["generatedAt"])) {
    diagnostics.push("generated_at_invalid");
  }
  if (!validTrustedReceiptKinds(record?.["receiptKinds"])) {
    diagnostics.push("receipt_kinds_invalid");
  }
  if (!declaredContentSha256) diagnostics.push("content_hash_missing");
  if (
    declaredContentSha256 &&
    recomputedContentSha256 &&
    declaredContentSha256 !== recomputedContentSha256
  ) {
    diagnostics.push("content_hash_mismatch");
  }
  if (!declaredAnchorSetSha256) diagnostics.push("anchor_set_missing");
  if (!Array.isArray(record?.["anchors"])) {
    diagnostics.push("anchors_not_array");
  } else {
    try {
      anchors = record["anchors"]
        .map(validateReceiptTrustAnchorDirectoryEntry)
        .sort(compareReceiptTrustAnchorDirectoryEntries);
      recomputedAnchorSetSha256 =
        receiptTrustAnchorDirectoryAnchorSetSha256(anchors);
      anchorCount = anchors.length;
      trustedCount = anchors.filter(
        (anchor) => anchor.status === "trusted",
      ).length;
      revokedCount = anchors.filter(
        (anchor) => anchor.status === "revoked",
      ).length;
    } catch {
      diagnostics.push("anchors_invalid");
    }
  }
  if (
    declaredAnchorSetSha256 &&
    recomputedAnchorSetSha256 &&
    declaredAnchorSetSha256 !== recomputedAnchorSetSha256
  ) {
    diagnostics.push("anchor_set_hash_mismatch");
  }
  if (
    record &&
    Object.keys(record).some(
      (key) => !RECEIPT_TRUST_ANCHOR_DIRECTORY_KEYS.includes(key),
    )
  ) {
    diagnostics.push("unsupported_fields");
  }
  if (!nonNegativeInteger(record?.["anchorCount"])) {
    diagnostics.push("anchor_count_invalid");
  } else if (
    anchorCount !== undefined &&
    record["anchorCount"] !== anchorCount
  ) {
    diagnostics.push("anchor_count_mismatch");
  }
  if (!nonNegativeInteger(record?.["trustedCount"])) {
    diagnostics.push("trusted_count_invalid");
  } else if (
    trustedCount !== undefined &&
    record["trustedCount"] !== trustedCount
  ) {
    diagnostics.push("trusted_count_mismatch");
  }
  if (!nonNegativeInteger(record?.["revokedCount"])) {
    diagnostics.push("revoked_count_invalid");
  } else if (
    revokedCount !== undefined &&
    record["revokedCount"] !== revokedCount
  ) {
    diagnostics.push("revoked_count_mismatch");
  }
  if (normalizedPolicy) {
    if (directoryAgeMs !== undefined && directoryAgeMs < 0) {
      diagnostics.push("generated_at_in_future");
    }
    if (
      normalizedPolicy.maxAgeMs !== undefined &&
      directoryAgeMs !== undefined &&
      directoryAgeMs > normalizedPolicy.maxAgeMs
    ) {
      diagnostics.push("directory_expired");
    }
    const observedAnchorSetSha256 =
      recomputedAnchorSetSha256 ?? declaredAnchorSetSha256;
    if (
      normalizedPolicy.expectedAnchorSetSha256 &&
      observedAnchorSetSha256 &&
      normalizedPolicy.expectedAnchorSetSha256 !== observedAnchorSetSha256
    ) {
      diagnostics.push("anchor_set_unexpected");
    }
    if (
      normalizedPolicy.minimumTrustedCount !== undefined &&
      trustedCount !== undefined &&
      trustedCount < normalizedPolicy.minimumTrustedCount
    ) {
      diagnostics.push("trusted_count_below_minimum");
    }
    if (normalizedPolicy.requiredTrustedKeyIds && anchors) {
      const trustedKeyIds = new Set(
        anchors
          .filter((anchor) => anchor.status === "trusted")
          .map((anchor) => anchor.keyId),
      );
      if (
        normalizedPolicy.requiredTrustedKeyIds.some(
          (keyId) => !trustedKeyIds.has(keyId),
        )
      ) {
        diagnostics.push("required_trusted_key_missing");
      }
    }
  }
  const status: ReceiptTrustAnchorDirectoryVerification["status"] =
    diagnostics.length === 0 ? "valid" : "invalid";
  const content = {
    kind: "napier.receipt-trust-anchor-directory-verification" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    status,
    diagnostics,
    ...(normalizedPolicy ? { policy: normalizedPolicy } : {}),
    ...(policySha256 ? { policySha256 } : {}),
    ...(directoryGeneratedAt ? { directoryGeneratedAt } : {}),
    ...(directoryAgeMs !== undefined ? { directoryAgeMs } : {}),
    ...(declaredContentSha256 ? { declaredContentSha256 } : {}),
    ...(recomputedContentSha256 ? { recomputedContentSha256 } : {}),
    ...(declaredAnchorSetSha256 ? { declaredAnchorSetSha256 } : {}),
    ...(recomputedAnchorSetSha256 ? { recomputedAnchorSetSha256 } : {}),
    ...(anchorCount !== undefined ? { anchorCount } : {}),
    ...(trustedCount !== undefined ? { trustedCount } : {}),
    ...(revokedCount !== undefined ? { revokedCount } : {}),
  };
  return {
    ...content,
    generatedAt: new Date(verifiedAtMs).toISOString(),
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function createReceiptTrustAnchorDirectoryMetadataReceipt(
  input: unknown,
  request: Pick<
    SignReceiptTrustAnchorDirectoryMetadataRequest,
    "publisher" | "sourceUrlSha256" | "sourceOriginSha256" | "expiresAt"
  >,
): ReceiptTrustAnchorDirectoryMetadataReceipt {
  const directory = validateReceiptTrustAnchorDirectory(input);
  const publisher = normalizePublisher(request.publisher);
  const generatedAt = nowIso();
  const sourceHashes = normalizeOptionalSourceHashes(
    request.sourceUrlSha256,
    request.sourceOriginSha256,
  );
  const expiresAt = normalizeOptionalMetadataExpiry(
    request.expiresAt,
    generatedAt,
  );
  const content = {
    kind: "napier.receipt-trust-anchor-directory-metadata-receipt" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    publisher,
    directorySha256: directory.contentSha256,
    anchorSetSha256: directory.anchorSetSha256,
    anchorCount: directory.anchorCount,
    trustedCount: directory.trustedCount,
    revokedCount: directory.revokedCount,
    ...sourceHashes,
    ...(expiresAt ? { expiresAt } : {}),
  };
  return {
    ...content,
    generatedAt,
    contentSha256: hashReceiptTrustAnchorDirectoryMetadataReceipt(content),
  };
}

export function hashReceiptTrustAnchorDirectoryMetadataReceipt(
  input: Omit<
    ReceiptTrustAnchorDirectoryMetadataReceipt,
    "generatedAt" | "contentSha256"
  >,
): string {
  return sha256(canonicalJson(input));
}

export function validateReceiptTrustAnchorDirectoryMetadataReceipt(
  value: unknown,
): ReceiptTrustAnchorDirectoryMetadataReceipt {
  if (!isRecord(value)) {
    throw new Error(
      "Receipt trust anchor directory metadata receipt is invalid",
    );
  }
  assertAllowedKeys(value, [
    "kind",
    "schemaVersion",
    "apiVersion",
    "generatedAt",
    "publisher",
    "directorySha256",
    "anchorSetSha256",
    "anchorCount",
    "trustedCount",
    "revokedCount",
    "sourceUrlSha256",
    "sourceOriginSha256",
    "expiresAt",
    "contentSha256",
  ]);
  const receipt =
    value as unknown as ReceiptTrustAnchorDirectoryMetadataReceipt;
  if (
    receipt.kind !== "napier.receipt-trust-anchor-directory-metadata-receipt" ||
    receipt.schemaVersion !== 1 ||
    receipt.apiVersion !== NAPIER_API_VERSION ||
    !validTimestamp(receipt.generatedAt) ||
    normalizePublisher(receipt.publisher) !== receipt.publisher ||
    !SHA256_PATTERN.test(receipt.directorySha256) ||
    !SHA256_PATTERN.test(receipt.anchorSetSha256) ||
    !nonNegativeInteger(receipt.anchorCount) ||
    !nonNegativeInteger(receipt.trustedCount) ||
    !nonNegativeInteger(receipt.revokedCount) ||
    receipt.trustedCount + receipt.revokedCount !== receipt.anchorCount ||
    !optionalSha256(receipt.sourceUrlSha256) ||
    !optionalSha256(receipt.sourceOriginSha256) ||
    (receipt.sourceUrlSha256 === undefined) !==
      (receipt.sourceOriginSha256 === undefined) ||
    (receipt.expiresAt !== undefined &&
      (!validTimestamp(receipt.expiresAt) ||
        receipt.expiresAt <= receipt.generatedAt)) ||
    !SHA256_PATTERN.test(receipt.contentSha256)
  ) {
    throw new Error(
      "Receipt trust anchor directory metadata receipt is invalid",
    );
  }
  const {
    generatedAt: _generatedAt,
    contentSha256: _contentSha256,
    ...content
  } = receipt;
  if (
    hashReceiptTrustAnchorDirectoryMetadataReceipt(content) !==
    receipt.contentSha256
  ) {
    throw new Error(
      "Receipt trust anchor directory metadata receipt hash mismatch",
    );
  }
  return structuredClone(receipt);
}

export function verifyReceiptTrustAnchorDirectoryMetadata(
  envelopeInput: unknown,
  directoryInput: unknown,
  anchors: ReceiptTrustAnchor[],
  options: {
    directoryPolicy?: ReceiptTrustAnchorDirectoryVerificationPolicy;
    trustDirectoryVerification?: ReceiptTrustAnchorDirectoryVerification;
  } = {},
): ReceiptTrustAnchorDirectoryMetadataVerification {
  const generatedAt = nowIso();
  const directoryVerification = verifyReceiptTrustAnchorDirectory(
    directoryInput,
    options.directoryPolicy,
  );
  const trustedReceiptVerification = verifyTrustedReceiptEnvelopeWithValidator(
    envelopeInput,
    anchors,
    validateMetadataTrustedReceipt,
  );
  const diagnostics: string[] = [];
  let metadata: ReceiptTrustAnchorDirectoryMetadataReceipt | undefined;
  let directory: ReceiptTrustAnchorDirectory | undefined;

  if (directoryVerification.status === "invalid") {
    diagnostics.push("directory_invalid");
  } else {
    directory = validateReceiptTrustAnchorDirectory(directoryInput);
  }
  if (options.trustDirectoryVerification?.status === "invalid") {
    diagnostics.push("trust_directory_invalid");
  }
  try {
    const envelope = validateTrustedReceiptEnvelopeWithValidator(
      envelopeInput,
      validateMetadataTrustedReceipt,
    );
    if (
      envelope.receiptKind !== "receipt_trust_anchor_directory_metadata" ||
      envelope.receipt.kind !==
        "napier.receipt-trust-anchor-directory-metadata-receipt"
    ) {
      throw new Error(
        "Receipt trust anchor directory metadata envelope kind mismatch",
      );
    }
    metadata = validateReceiptTrustAnchorDirectoryMetadataReceipt(
      envelope.receipt,
    );
  } catch {
    diagnostics.push("metadata_envelope_invalid");
  }

  if (trustedReceiptVerification.status === "invalid") {
    diagnostics.push("signature_invalid");
  } else if (trustedReceiptVerification.status === "unknown_key") {
    diagnostics.push("signer_unknown");
  } else if (trustedReceiptVerification.status === "revoked") {
    diagnostics.push("signer_revoked");
  }

  const directoryBindingValid = Boolean(
    metadata &&
    directory &&
    metadata.directorySha256 === directory.contentSha256 &&
    metadata.anchorSetSha256 === directory.anchorSetSha256 &&
    metadata.anchorCount === directory.anchorCount &&
    metadata.trustedCount === directory.trustedCount &&
    metadata.revokedCount === directory.revokedCount,
  );
  if (metadata && directory && !directoryBindingValid) {
    diagnostics.push("directory_binding_mismatch");
  }
  if (metadata?.expiresAt && Date.parse(metadata.expiresAt) <= Date.now()) {
    diagnostics.push("metadata_expired");
  }

  const hardInvalid = diagnostics.some(
    (diagnostic) =>
      diagnostic !== "signer_unknown" && diagnostic !== "signer_revoked",
  );
  const status: ReceiptTrustAnchorDirectoryMetadataVerification["status"] =
    hardInvalid ? "invalid" : trustedReceiptVerification.status;
  const content = {
    kind: "napier.receipt-trust-anchor-directory-metadata-verification" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    status,
    diagnostics,
    trustedReceiptVerification,
    directoryVerification,
    ...(options.trustDirectoryVerification
      ? { trustDirectoryVerification: options.trustDirectoryVerification }
      : {}),
    ...(metadata ? { metadata } : {}),
    ...(metadata ? { publisher: metadata.publisher } : {}),
    ...(metadata ? { directorySha256: metadata.directorySha256 } : {}),
    ...(metadata ? { anchorSetSha256: metadata.anchorSetSha256 } : {}),
    ...(trustedReceiptVerification.keyId
      ? { signerKeyId: trustedReceiptVerification.keyId }
      : {}),
    ...(trustedReceiptVerification.envelopeSha256
      ? { envelopeSha256: trustedReceiptVerification.envelopeSha256 }
      : {}),
    signatureValid: trustedReceiptVerification.signatureValid,
    integrityValid: trustedReceiptVerification.integrityValid,
    directoryBindingValid,
    ...(metadata?.expiresAt ? { expiresAt: metadata.expiresAt } : {}),
  };
  return {
    ...content,
    generatedAt,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function receiptTrustAnchorsFromDirectory(
  input: unknown,
): ReceiptTrustAnchor[] {
  return validateReceiptTrustAnchorDirectory(input).anchors.map((entry) =>
    validateReceiptTrustAnchor({
      id: entry.id,
      label: entry.label,
      algorithm: entry.algorithm,
      keyId: entry.keyId,
      publicKeySpki: entry.publicKeySpki,
      status: entry.status,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      ...(entry.revokedAt ? { revokedAt: entry.revokedAt } : {}),
      contentSha256: entry.anchorSha256,
    }),
  );
}

export function signTrustedReceiptWithValidator<Receipt extends TrustedReceipt>(
  receipt: Receipt,
  anchor: ReceiptTrustAnchor,
  validateReceipt: TrustedReceiptValidator,
  environment: NodeJS.ProcessEnv = process.env,
): TrustedReceiptEnvelope<Receipt> {
  const trustedAnchor = validateReceiptTrustAnchor(anchor);
  if (trustedAnchor.status !== "trusted") {
    throw new Error(`Receipt trust anchor is revoked: ${trustedAnchor.id}`);
  }
  if (!trustedAnchor.signingSource) {
    throw new Error(`Receipt trust anchor is verify-only: ${trustedAnchor.id}`);
  }
  const validated = validateReceipt(receipt);
  const validatedReceipt = validated.receipt as Receipt;
  const privateValue = environment[trustedAnchor.signingSource.variable];
  if (!privateValue) {
    throw new Error(
      `Receipt signing key is unavailable: ${trustedAnchor.signingSource.variable}`,
    );
  }
  const privateKey = parsePrivateKey(privateValue);
  const derivedPublicKey = createPublicKey(privateKey);
  assertEd25519Key(derivedPublicKey, "Receipt signing key");
  if (exportPublicKeySpki(derivedPublicKey) !== trustedAnchor.publicKeySpki) {
    throw new Error("Receipt signing key does not match the trust anchor");
  }
  const receiptKind = validated.receiptKind;
  const receiptArtifactSha256 = sha256(canonicalJson(validatedReceipt));
  const signedAt = nowIso();
  const statement = createSignatureStatement(
    receiptKind,
    validatedReceipt.contentSha256,
    receiptArtifactSha256,
    trustedAnchor.keyId,
    signedAt,
  );
  const statementJson = canonicalJson(statement);
  const signature = {
    algorithm: "Ed25519" as const,
    keyId: trustedAnchor.keyId,
    signedAt,
    receiptArtifactSha256,
    statementSha256: sha256(statementJson),
    value: sign(null, Buffer.from(statementJson), privateKey).toString(
      "base64url",
    ),
  };
  const content = {
    kind: "napier.trusted-receipt-envelope" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    receiptKind,
    receipt: validatedReceipt,
    signature,
  };
  return {
    ...content,
    contentSha256: hashTrustedReceiptEnvelope(content),
  };
}

export function hashTrustedReceiptEnvelope(
  envelope: Omit<TrustedReceiptEnvelope, "contentSha256">,
): string {
  return sha256(canonicalJson(envelope));
}

export function validateTrustedReceiptEnvelopeWithValidator(
  value: unknown,
  validateReceipt: TrustedReceiptValidator,
): TrustedReceiptEnvelope {
  if (
    !isRecord(value) ||
    Buffer.byteLength(JSON.stringify(value)) > MAX_TRUSTED_RECEIPT_BYTES
  ) {
    throw new Error("Trusted receipt envelope is invalid");
  }
  assertAllowedKeys(value, [
    "kind",
    "schemaVersion",
    "apiVersion",
    "receiptKind",
    "receipt",
    "signature",
    "contentSha256",
  ]);
  const envelope = value as unknown as TrustedReceiptEnvelope;
  if (
    envelope.kind !== "napier.trusted-receipt-envelope" ||
    envelope.schemaVersion !== 1 ||
    envelope.apiVersion !== NAPIER_API_VERSION ||
    !TRUSTED_RECEIPT_KINDS.includes(envelope.receiptKind) ||
    !SHA256_PATTERN.test(envelope.contentSha256)
  ) {
    throw new Error("Trusted receipt envelope header is invalid");
  }
  const validated = validateReceipt(envelope.receipt);
  const receipt = validated.receipt;
  if (validated.receiptKind !== envelope.receiptKind) {
    throw new Error("Trusted receipt kind does not match its payload");
  }
  if (!isRecord(envelope.signature)) {
    throw new Error("Trusted receipt signature is invalid");
  }
  assertAllowedKeys(envelope.signature, [
    "algorithm",
    "keyId",
    "signedAt",
    "receiptArtifactSha256",
    "statementSha256",
    "value",
  ]);
  const signature = envelope.signature;
  const signatureBytes = decodeSignature(signature.value);
  if (
    signature.algorithm !== "Ed25519" ||
    !SHA256_PATTERN.test(signature.keyId) ||
    !validTimestamp(signature.signedAt) ||
    !SHA256_PATTERN.test(signature.receiptArtifactSha256) ||
    !SHA256_PATTERN.test(signature.statementSha256) ||
    signatureBytes.byteLength !== 64
  ) {
    throw new Error("Trusted receipt signature evidence is invalid");
  }
  const statement = createSignatureStatement(
    envelope.receiptKind,
    receipt.contentSha256,
    signature.receiptArtifactSha256,
    signature.keyId,
    signature.signedAt,
  );
  if (sha256(canonicalJson(statement)) !== signature.statementSha256) {
    throw new Error("Trusted receipt signature statement hash mismatch");
  }
  if (sha256(canonicalJson(receipt)) !== signature.receiptArtifactSha256) {
    throw new Error("Trusted receipt artifact hash mismatch");
  }
  const { contentSha256: _contentSha256, ...content } = envelope;
  if (hashTrustedReceiptEnvelope(content) !== envelope.contentSha256) {
    throw new Error("Trusted receipt envelope content hash mismatch");
  }
  return structuredClone({
    ...envelope,
    receipt,
  });
}

export function verifyTrustedReceiptEnvelopeWithValidator(
  value: unknown,
  anchors: ReceiptTrustAnchor[],
  validateReceipt: TrustedReceiptValidator,
): TrustedReceiptVerification {
  const verifiedAt = nowIso();
  let envelope: TrustedReceiptEnvelope;
  try {
    envelope = validateTrustedReceiptEnvelopeWithValidator(
      value,
      validateReceipt,
    );
  } catch (error) {
    return {
      status: "invalid",
      verifiedAt,
      signatureValid: false,
      integrityValid: false,
      reason: safeError(error),
    };
  }
  const anchor = anchors
    .map((candidate) => validateReceiptTrustAnchor(candidate))
    .find((candidate) => candidate.keyId === envelope.signature.keyId);
  if (!anchor) {
    return {
      status: "unknown_key",
      verifiedAt,
      receiptKind: envelope.receiptKind,
      receiptContentSha256: envelope.receipt.contentSha256,
      receiptArtifactSha256: envelope.signature.receiptArtifactSha256,
      keyId: envelope.signature.keyId,
      envelopeSha256: envelope.contentSha256,
      signatureValid: false,
      integrityValid: true,
      reason: "No trusted public key matches the receipt signature",
    };
  }
  const statement = createSignatureStatement(
    envelope.receiptKind,
    envelope.receipt.contentSha256,
    envelope.signature.receiptArtifactSha256,
    envelope.signature.keyId,
    envelope.signature.signedAt,
  );
  const signatureValid = verify(
    null,
    Buffer.from(canonicalJson(statement)),
    parsePublicKeySpki(anchor.publicKeySpki),
    decodeSignature(envelope.signature.value),
  );
  if (!signatureValid) {
    return {
      status: "invalid",
      verifiedAt,
      receiptKind: envelope.receiptKind,
      receiptContentSha256: envelope.receipt.contentSha256,
      receiptArtifactSha256: envelope.signature.receiptArtifactSha256,
      keyId: envelope.signature.keyId,
      envelopeSha256: envelope.contentSha256,
      signatureValid: false,
      integrityValid: true,
      reason: "Receipt signature verification failed",
    };
  }
  return {
    status: anchor.status,
    verifiedAt,
    receiptKind: envelope.receiptKind,
    receiptContentSha256: envelope.receipt.contentSha256,
    receiptArtifactSha256: envelope.signature.receiptArtifactSha256,
    keyId: envelope.signature.keyId,
    envelopeSha256: envelope.contentSha256,
    signatureValid: true,
    integrityValid: true,
    reason:
      anchor.status === "trusted"
        ? "Receipt signature and evidence are trusted"
        : "Receipt signature is valid, but its trust anchor is revoked",
  };
}

export function createEvaluationQualificationBaseline(
  envelope: TrustedReceiptEnvelope<EvaluationCasebookQualificationReceipt>,
  casebook: EvaluationCasebook,
  promotedByThreadId: string,
  supersedesBaselineId?: string,
): EvaluationQualificationBaseline {
  const trustedEnvelope = validateTrustedReceiptEnvelopeWithValidator(
    envelope,
    validateCasebookQualificationTrustedReceipt,
  );
  if (
    trustedEnvelope.receiptKind !== "casebook_qualification" ||
    trustedEnvelope.receipt.kind !==
      "napier.evaluation-casebook-qualification-receipt"
  ) {
    throw new Error("Qualification baseline requires a Casebook receipt");
  }
  const receipt = trustedEnvelope.receipt;
  const execution = receipt.execution;
  const revision = casebook.revisions.at(-1);
  if (
    receipt.state !== "passed" ||
    !execution ||
    receipt.casebook.id !== casebook.id ||
    receipt.casebook.currentRevision !== casebook.currentRevision ||
    receipt.casebook.revisions.at(-1)?.contentSha256 !==
      revision?.contentSha256 ||
    execution.casebookRevision !== casebook.currentRevision ||
    execution.casebookRevisionSha256 !== revision?.contentSha256 ||
    !RESOURCE_ID_PATTERN.test(promotedByThreadId) ||
    (supersedesBaselineId !== undefined &&
      !RESOURCE_ID_PATTERN.test(supersedesBaselineId))
  ) {
    throw new Error(
      "Qualification baseline requires a current passing receipt",
    );
  }
  const content = {
    id: createId("qualbase"),
    casebookId: casebook.id,
    casebookRevision: casebook.currentRevision,
    casebookRevisionSha256: revision.contentSha256,
    qualificationExecutionId: execution.id,
    qualificationExecutionSha256: execution.contentSha256,
    envelope:
      trustedEnvelope as TrustedReceiptEnvelope<EvaluationCasebookQualificationReceipt>,
    promotedByThreadId,
    ...(supersedesBaselineId ? { supersedesBaselineId } : {}),
    createdAt: nowIso(),
  };
  return {
    ...content,
    contentSha256: hashEvaluationQualificationBaseline(content),
  };
}

export function hashEvaluationQualificationBaseline(
  baseline: Omit<EvaluationQualificationBaseline, "contentSha256">,
): string {
  return sha256(canonicalJson(baseline));
}

export function validateEvaluationQualificationBaseline(
  value: unknown,
  anchors?: ReceiptTrustAnchor[],
): EvaluationQualificationBaseline {
  if (!isRecord(value)) {
    throw new Error("Evaluation qualification baseline must be an object");
  }
  assertAllowedKeys(value, [
    "id",
    "casebookId",
    "casebookRevision",
    "casebookRevisionSha256",
    "qualificationExecutionId",
    "qualificationExecutionSha256",
    "envelope",
    "promotedByThreadId",
    "supersedesBaselineId",
    "createdAt",
    "contentSha256",
  ]);
  const baseline = value as unknown as EvaluationQualificationBaseline;
  const envelope = validateTrustedReceiptEnvelopeWithValidator(
    baseline.envelope,
    validateCasebookQualificationTrustedReceipt,
  );
  if (
    !RESOURCE_ID_PATTERN.test(baseline.id) ||
    !RESOURCE_ID_PATTERN.test(baseline.casebookId) ||
    !Number.isInteger(baseline.casebookRevision) ||
    baseline.casebookRevision < 1 ||
    !SHA256_PATTERN.test(baseline.casebookRevisionSha256) ||
    !RESOURCE_ID_PATTERN.test(baseline.qualificationExecutionId) ||
    !SHA256_PATTERN.test(baseline.qualificationExecutionSha256) ||
    !RESOURCE_ID_PATTERN.test(baseline.promotedByThreadId) ||
    (baseline.supersedesBaselineId !== undefined &&
      !RESOURCE_ID_PATTERN.test(baseline.supersedesBaselineId)) ||
    !validTimestamp(baseline.createdAt) ||
    !SHA256_PATTERN.test(baseline.contentSha256) ||
    envelope.receiptKind !== "casebook_qualification" ||
    envelope.receipt.kind !== "napier.evaluation-casebook-qualification-receipt"
  ) {
    throw new Error("Evaluation qualification baseline is invalid");
  }
  const receipt = envelope.receipt;
  if (
    receipt.state !== "passed" ||
    !receipt.execution ||
    receipt.casebook.id !== baseline.casebookId ||
    receipt.casebook.currentRevision !== baseline.casebookRevision ||
    receipt.casebook.revisions.at(-1)?.contentSha256 !==
      baseline.casebookRevisionSha256 ||
    receipt.execution.id !== baseline.qualificationExecutionId ||
    receipt.execution.contentSha256 !== baseline.qualificationExecutionSha256
  ) {
    throw new Error("Evaluation qualification baseline evidence is invalid");
  }
  if (anchors) {
    const verification = verifyTrustedReceiptEnvelopeWithValidator(
      envelope,
      anchors,
      validateCasebookQualificationTrustedReceipt,
    );
    if (!verification.integrityValid || !verification.signatureValid) {
      throw new Error(
        `Evaluation qualification baseline signature is invalid: ${verification.reason}`,
      );
    }
  }
  const { contentSha256: _contentSha256, ...content } = baseline;
  if (hashEvaluationQualificationBaseline(content) !== baseline.contentSha256) {
    throw new Error("Evaluation qualification baseline hash mismatch");
  }
  return structuredClone({
    ...baseline,
    envelope:
      envelope as TrustedReceiptEnvelope<EvaluationCasebookQualificationReceipt>,
  });
}

function validateMetadataTrustedReceipt(
  value: unknown,
): ValidatedTrustedReceipt {
  return {
    receipt: validateReceiptTrustAnchorDirectoryMetadataReceipt(value),
    receiptKind: "receipt_trust_anchor_directory_metadata",
  };
}

function validateCasebookQualificationTrustedReceipt(
  value: unknown,
): ValidatedTrustedReceipt {
  return {
    receipt: validateEvaluationCasebookQualificationReceipt(value),
    receiptKind: "casebook_qualification",
  };
}

function createSignatureStatement(
  receiptKind: TrustedReceiptKind,
  receiptContentSha256: string,
  receiptArtifactSha256: string,
  keyId: string,
  signedAt: string,
): ReceiptSignatureStatement {
  return {
    kind: "napier.receipt-signature-statement",
    schemaVersion: 1,
    apiVersion: NAPIER_API_VERSION,
    receiptKind,
    receiptContentSha256,
    receiptArtifactSha256,
    keyId,
    signedAt,
  };
}

function hashPublicKeySpki(publicKeySpki: string): string {
  return sha256(Buffer.from(publicKeySpki, "base64"));
}

function exportPublicKeySpki(key: KeyObject): string {
  return Buffer.from(key.export({ format: "der", type: "spki" })).toString(
    "base64",
  );
}

function parsePublicKeySpki(value: string): KeyObject {
  if (typeof value !== "string" || value.length > 4_096) {
    throw new Error("Receipt trust anchor public key is invalid");
  }
  const bytes = decodeCanonicalBase64(value);
  try {
    return createPublicKey({ key: bytes, format: "der", type: "spki" });
  } catch {
    throw new Error("Receipt trust anchor public key is invalid");
  }
}

function parsePrivateKey(value: string): KeyObject {
  try {
    const key = value.startsWith("base64:")
      ? createPrivateKey({
          key: decodeCanonicalBase64(value.slice("base64:".length)),
          format: "der",
          type: "pkcs8",
        })
      : createPrivateKey(value);
    assertEd25519Key(key, "Receipt signing key");
    return key;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Receipt signing key must be Ed25519"
    ) {
      throw error;
    }
    throw new Error("Receipt signing key is not a valid PKCS#8 private key");
  }
}

function assertEd25519Key(key: KeyObject, label: string): void {
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error(`${label} must be Ed25519`);
  }
}

function decodeCanonicalBase64(value: string): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new Error("Base64 evidence is invalid");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== value) {
    throw new Error("Base64 evidence is invalid");
  }
  return bytes;
}

function decodeSignature(value: string): Buffer {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_-]+$/.test(value) ||
    value.length > 128
  ) {
    throw new Error("Trusted receipt signature value is invalid");
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value) {
    throw new Error("Trusted receipt signature value is invalid");
  }
  return bytes;
}

function normalizeLabel(value: string): string {
  const label = value?.replace(/\s+/g, " ").trim();
  if (!label || label.length > 100) {
    throw new Error("Receipt trust anchor label is invalid");
  }
  return label;
}

function normalizeEnvironmentName(value: string): string {
  const variable = value?.trim().toUpperCase();
  if (!ENVIRONMENT_NAME_PATTERN.test(variable)) {
    throw new Error("Receipt signing environment variable is invalid");
  }
  return variable;
}

function normalizePublisher(value: string): string {
  const publisher = value?.replace(/\s+/g, " ").trim();
  if (
    !publisher ||
    publisher.length > 120 ||
    /[\u0000-\u001f\u007f<>]/.test(publisher)
  ) {
    throw new Error(
      "Receipt trust anchor directory metadata publisher is invalid",
    );
  }
  return publisher;
}

function normalizeOptionalSourceHashes(
  sourceUrlSha256: string | undefined,
  sourceOriginSha256: string | undefined,
): { sourceUrlSha256?: string; sourceOriginSha256?: string } {
  if (
    (sourceUrlSha256 === undefined) !== (sourceOriginSha256 === undefined) ||
    !optionalSha256(sourceUrlSha256) ||
    !optionalSha256(sourceOriginSha256)
  ) {
    throw new Error(
      "Receipt trust anchor directory metadata source hash is invalid",
    );
  }
  return sourceUrlSha256 && sourceOriginSha256
    ? { sourceUrlSha256, sourceOriginSha256 }
    : {};
}

function normalizeOptionalMetadataExpiry(
  expiresAt: string | undefined,
  generatedAt: string,
): string | undefined {
  if (expiresAt === undefined) return undefined;
  if (!validTimestamp(expiresAt) || expiresAt <= generatedAt) {
    throw new Error(
      "Receipt trust anchor directory metadata expiry is invalid",
    );
  }
  return expiresAt;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function optionalSha256(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "string" && SHA256_PATTERN.test(value))
  );
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

export function normalizeReceiptTrustAnchorDirectoryVerificationPolicy(
  policy: ReceiptTrustAnchorDirectoryVerificationPolicy | undefined,
): ReceiptTrustAnchorDirectoryVerificationPolicy | undefined {
  if (policy === undefined) return undefined;
  if (!isRecord(policy)) {
    throw new Error("Receipt trust anchor directory policy is invalid");
  }
  assertAllowedKeys(
    policy,
    RECEIPT_TRUST_ANCHOR_DIRECTORY_VERIFICATION_POLICY_KEYS,
  );
  const normalized: ReceiptTrustAnchorDirectoryVerificationPolicy = {};
  if (policy.maxAgeMs !== undefined) {
    if (!nonNegativeInteger(policy.maxAgeMs)) {
      throw new Error("Receipt trust anchor directory policy age is invalid");
    }
    normalized.maxAgeMs = policy.maxAgeMs;
  }
  if (policy.expectedAnchorSetSha256 !== undefined) {
    if (!isSha256(policy.expectedAnchorSetSha256)) {
      throw new Error("Receipt trust anchor directory policy hash is invalid");
    }
    normalized.expectedAnchorSetSha256 = policy.expectedAnchorSetSha256;
  }
  if (policy.minimumTrustedCount !== undefined) {
    if (!nonNegativeInteger(policy.minimumTrustedCount)) {
      throw new Error("Receipt trust anchor directory policy count is invalid");
    }
    normalized.minimumTrustedCount = policy.minimumTrustedCount;
  }
  if (policy.requiredTrustedKeyIds !== undefined) {
    if (
      !Array.isArray(policy.requiredTrustedKeyIds) ||
      policy.requiredTrustedKeyIds.length > MAX_RECEIPT_TRUST_ANCHORS ||
      policy.requiredTrustedKeyIds.some((keyId) => !isSha256(keyId))
    ) {
      throw new Error("Receipt trust anchor directory policy keys are invalid");
    }
    normalized.requiredTrustedKeyIds = Array.from(
      new Set(policy.requiredTrustedKeyIds),
    ).sort();
  }
  return normalized;
}

export function hashReceiptTrustAnchorDirectoryVerificationPolicy(
  policy: ReceiptTrustAnchorDirectoryVerificationPolicy,
): string {
  const normalized =
    normalizeReceiptTrustAnchorDirectoryVerificationPolicy(policy);
  if (!normalized) {
    throw new Error("Receipt trust anchor directory policy is required");
  }
  return sha256(canonicalJson(normalized));
}

function createReceiptTrustAnchorDirectoryEntry(
  anchor: ReceiptTrustAnchor,
): ReceiptTrustAnchorDirectoryEntry {
  const current = validateReceiptTrustAnchor(anchor);
  const content = receiptTrustAnchorDirectoryEntryHashContent(current);
  return {
    ...content,
    anchorSha256: sha256(canonicalJson(content)),
  };
}

function validateReceiptTrustAnchorDirectoryEntry(
  value: unknown,
): ReceiptTrustAnchorDirectoryEntry {
  if (!isRecord(value)) {
    throw new Error("Receipt trust anchor directory entry is invalid");
  }
  assertAllowedKeys(value, RECEIPT_TRUST_ANCHOR_DIRECTORY_ENTRY_KEYS);
  const entry = value as unknown as ReceiptTrustAnchorDirectoryEntry;
  if (
    !RESOURCE_ID_PATTERN.test(entry.id) ||
    normalizeLabel(entry.label) !== entry.label ||
    entry.algorithm !== "Ed25519" ||
    !SHA256_PATTERN.test(entry.keyId) ||
    (entry.status !== "trusted" && entry.status !== "revoked") ||
    !validTimestamp(entry.createdAt) ||
    !validTimestamp(entry.updatedAt) ||
    entry.updatedAt < entry.createdAt ||
    (entry.status === "trusted" && entry.revokedAt !== undefined) ||
    (entry.status === "revoked" && !validTimestamp(entry.revokedAt)) ||
    (entry.revokedAt !== undefined &&
      (entry.revokedAt < entry.createdAt ||
        entry.revokedAt !== entry.updatedAt)) ||
    !SHA256_PATTERN.test(entry.anchorSha256)
  ) {
    throw new Error("Receipt trust anchor directory entry is invalid");
  }
  const publicKey = parsePublicKeySpki(entry.publicKeySpki);
  assertEd25519Key(publicKey, "Receipt trust anchor directory entry");
  const normalizedSpki = exportPublicKeySpki(publicKey);
  if (
    normalizedSpki !== entry.publicKeySpki ||
    hashPublicKeySpki(normalizedSpki) !== entry.keyId
  ) {
    throw new Error("Receipt trust anchor directory key mismatch");
  }
  const { anchorSha256: _anchorSha256, ...content } = entry;
  if (sha256(canonicalJson(content)) !== entry.anchorSha256) {
    throw new Error("Receipt trust anchor directory entry hash mismatch");
  }
  return structuredClone(entry);
}

function receiptTrustAnchorDirectoryEntryHashContent(
  anchor: ReceiptTrustAnchor,
): Omit<ReceiptTrustAnchorDirectoryEntry, "anchorSha256"> {
  return {
    id: anchor.id,
    label: anchor.label,
    algorithm: anchor.algorithm,
    keyId: anchor.keyId,
    publicKeySpki: anchor.publicKeySpki,
    status: anchor.status,
    createdAt: anchor.createdAt,
    updatedAt: anchor.updatedAt,
    ...(anchor.revokedAt ? { revokedAt: anchor.revokedAt } : {}),
  };
}

function receiptTrustAnchorDirectoryAnchorSetSha256(
  anchors: ReceiptTrustAnchorDirectoryEntry[],
): string {
  return sha256(
    canonicalJson(
      anchors
        .map(validateReceiptTrustAnchorDirectoryEntry)
        .sort(compareReceiptTrustAnchorDirectoryEntries),
    ),
  );
}

function receiptTrustAnchorDirectoryHashContent(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const {
    contentSha256: _contentSha256,
    generatedAt: _generatedAt,
    ...content
  } = record;
  return content;
}

function compareReceiptTrustAnchorDirectoryEntries(
  left: ReceiptTrustAnchorDirectoryEntry,
  right: ReceiptTrustAnchorDirectoryEntry,
): number {
  return (
    left.keyId.localeCompare(right.keyId) || left.id.localeCompare(right.id)
  );
}

function validTrustedReceiptKinds(
  value: unknown,
): value is TrustedReceiptKind[] {
  return (
    Array.isArray(value) &&
    value.length === TRUSTED_RECEIPT_KINDS.length &&
    TRUSTED_RECEIPT_KINDS.every((kind, index) => value[index] === kind)
  );
}

function safeError(error: unknown): string {
  return error instanceof Error
    ? error.message.slice(0, 500)
    : "Trusted receipt verification failed";
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowed: string[],
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new Error("Trusted receipt contains unsupported fields");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}
