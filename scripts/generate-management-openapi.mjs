import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(scriptPath), "..");
const defaultSourcePath = "apps/server/src/app.ts";
const defaultArtifactPath = "docs/artifacts/management-openapi-0.1.0.json";
const PROMOTED_OPERATION_SCHEMAS = {
  "GET /api/health": {
    responses: {
      200: "#/components/schemas/HealthResponse",
    },
  },
  "GET /api/receipt-trust/anchors": {
    responses: {
      200: "#/components/schemas/ReceiptTrustAnchorList",
    },
  },
  "GET /api/receipt-trust/anchors/directory": {
    responses: {
      200: "#/components/schemas/ReceiptTrustAnchorDirectory",
    },
  },
  "POST /api/receipt-trust/anchors/directory/discover": {
    request: "#/components/schemas/DiscoverReceiptTrustAnchorDirectoryRequest",
    responses: {
      200: "#/components/schemas/ReceiptTrustAnchorDirectoryDiscovery",
    },
  },
  "POST /api/receipt-trust/anchors/directory/metadata/verify": {
    request:
      "#/components/schemas/VerifyReceiptTrustAnchorDirectoryMetadataRequest",
    responses: {
      200: "#/components/schemas/ReceiptTrustAnchorDirectoryMetadataVerification",
    },
  },
  "POST /api/receipt-trust/anchors/directory/signed-metadata": {
    request:
      "#/components/schemas/SignReceiptTrustAnchorDirectoryMetadataRequest",
    responses: {
      201: "#/components/schemas/ReceiptTrustAnchorDirectoryMetadataEnvelope",
    },
  },
  "POST /api/receipt-trust/anchors/directory/verify": {
    request: "#/components/schemas/VerifyReceiptTrustAnchorDirectoryRequest",
    responses: {
      200: "#/components/schemas/ReceiptTrustAnchorDirectoryVerification",
    },
  },
  "POST /api/receipt-trust/anchors": {
    request: "#/components/schemas/CreateReceiptTrustAnchorRequest",
    responses: {
      201: "#/components/schemas/ReceiptTrustAnchor",
    },
  },
  "POST /api/receipt-trust/anchors/{anchorId}/revoke": {
    request: "#/components/schemas/RevokeReceiptTrustAnchorRequest",
    responses: {
      200: "#/components/schemas/ReceiptTrustAnchor",
    },
  },
};

export async function generateManagementOpenApi(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const sourcePath = options.sourcePath ?? defaultSourcePath;
  const absoluteSourcePath = resolveRepoRelativePath(
    repoRoot,
    sourcePath,
    "sourcePath",
  );
  const sourceText = await readFile(absoluteSourcePath, "utf8");
  const packageJson = parseJson(
    await readFile(path.join(repoRoot, "package.json"), "utf8"),
    "package.json",
  );
  const routes = extractManagementRoutes(sourceText);
  const routeSetSha256 = sha256Text(
    stableJson(
      routes.map((route) => ({
        method: route.method,
        path: route.openapiPath,
      })),
    ),
  );
  const paths = {};
  for (const route of routes) {
    paths[route.openapiPath] ??= {};
    paths[route.openapiPath][route.method] = createOperation(route);
  }
  const artifact = {
    openapi: "3.1.0",
    jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
    info: {
      title: "Napier Management API",
      version:
        isRecord(packageJson) && typeof packageJson.version === "string"
          ? packageJson.version
          : "0.0.0",
      description:
        "Generated route-level OpenAPI contract for Napier's local management plane. Request and response schemas are intentionally conservative until endpoint-level schemas are promoted.",
    },
    servers: [
      {
        url: "http://127.0.0.1:8787",
        description: "Local Napier API process",
      },
    ],
    paths,
    components: {
      schemas: {
        ErrorResponse: {
          type: "object",
          required: ["error"],
          additionalProperties: false,
          properties: {
            error: { type: "string" },
          },
        },
        HealthResponse: {
          type: "object",
          required: ["status", "service", "time", "runtime", "ledger"],
          additionalProperties: false,
          properties: {
            status: { $ref: "#/components/schemas/HealthStatus" },
            service: { const: "napier" },
            time: { type: "string", format: "date-time" },
            runtime: { $ref: "#/components/schemas/HealthRuntime" },
            ledger: { $ref: "#/components/schemas/HealthLedger" },
          },
        },
        HealthStatus: {
          type: "string",
          enum: ["ok", "degraded", "failed"],
        },
        HealthRuntime: {
          type: "object",
          required: ["node", "components"],
          additionalProperties: false,
          properties: {
            node: { $ref: "#/components/schemas/HealthRuntimeNode" },
            components: {
              $ref: "#/components/schemas/HealthRuntimeComponents",
            },
          },
        },
        HealthRuntimeNode: {
          type: "object",
          required: ["version", "platform", "arch"],
          additionalProperties: false,
          properties: {
            version: { type: "string" },
            platform: { type: "string" },
            arch: { type: "string" },
          },
        },
        HealthRuntimeComponents: {
          type: "object",
          required: ["sqlite", "openssl", "uv", "v8"],
          additionalProperties: false,
          properties: {
            sqlite: { type: "string" },
            openssl: { type: "string" },
            uv: { type: "string" },
            v8: { type: "string" },
          },
        },
        HealthLedger: {
          type: "object",
          required: ["schemaVersion", "quickCheck", "migrations"],
          additionalProperties: false,
          properties: {
            schemaVersion: { type: "integer", minimum: 0 },
            quickCheck: { type: "string" },
            migrations: {
              type: "array",
              items: { $ref: "#/components/schemas/HealthMigration" },
            },
          },
        },
        HealthMigration: {
          type: "object",
          required: ["version", "name", "appliedAt"],
          additionalProperties: false,
          properties: {
            version: { type: "integer", minimum: 0 },
            name: { type: "string" },
            appliedAt: { type: "string", format: "date-time" },
          },
        },
        ReceiptTrustAnchorList: {
          type: "array",
          items: { $ref: "#/components/schemas/ReceiptTrustAnchor" },
        },
        ReceiptTrustAnchor: {
          type: "object",
          required: [
            "id",
            "label",
            "algorithm",
            "keyId",
            "publicKeySpki",
            "status",
            "createdAt",
            "updatedAt",
            "contentSha256",
          ],
          additionalProperties: false,
          properties: {
            id: { type: "string", pattern: "^trustkey_[a-z0-9]{8,80}$" },
            label: { type: "string", minLength: 1, maxLength: 100 },
            algorithm: { const: "Ed25519" },
            keyId: { $ref: "#/components/schemas/Sha256Hex" },
            publicKeySpki: { type: "string", minLength: 1 },
            signingSource: {
              $ref: "#/components/schemas/ReceiptTrustAnchorSigningSource",
            },
            status: { $ref: "#/components/schemas/ReceiptTrustAnchorStatus" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
            revokedAt: { type: "string", format: "date-time" },
            contentSha256: { $ref: "#/components/schemas/Sha256Hex" },
          },
        },
        ReceiptTrustAnchorStatus: {
          type: "string",
          enum: ["trusted", "revoked"],
        },
        ReceiptTrustAnchorDirectory: {
          type: "object",
          required: [
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
          ],
          additionalProperties: false,
          properties: {
            kind: { const: "napier.receipt-trust-anchor-directory" },
            schemaVersion: { const: 1 },
            apiVersion: { type: "string", minLength: 1 },
            generatedAt: { type: "string", format: "date-time" },
            receiptKinds: {
              type: "array",
              minItems: 11,
              maxItems: 11,
              items: { $ref: "#/components/schemas/TrustedReceiptKind" },
            },
            anchorCount: { type: "integer", minimum: 0 },
            trustedCount: { type: "integer", minimum: 0 },
            revokedCount: { type: "integer", minimum: 0 },
            anchorSetSha256: { $ref: "#/components/schemas/Sha256Hex" },
            anchors: {
              type: "array",
              items: {
                $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryEntry",
              },
            },
            contentSha256: { $ref: "#/components/schemas/Sha256Hex" },
          },
        },
        ReceiptTrustAnchorDirectoryEntry: {
          type: "object",
          required: [
            "id",
            "label",
            "algorithm",
            "keyId",
            "publicKeySpki",
            "status",
            "createdAt",
            "updatedAt",
            "anchorSha256",
          ],
          additionalProperties: false,
          properties: {
            id: { type: "string", pattern: "^trustkey_[a-z0-9]{8,80}$" },
            label: { type: "string", minLength: 1, maxLength: 100 },
            algorithm: { const: "Ed25519" },
            keyId: { $ref: "#/components/schemas/Sha256Hex" },
            publicKeySpki: { type: "string", minLength: 1 },
            status: { $ref: "#/components/schemas/ReceiptTrustAnchorStatus" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
            revokedAt: { type: "string", format: "date-time" },
            anchorSha256: { $ref: "#/components/schemas/Sha256Hex" },
          },
        },
        ReceiptTrustAnchorDirectoryVerificationPolicy: {
          type: "object",
          additionalProperties: false,
          properties: {
            maxAgeMs: { type: "integer", minimum: 0 },
            expectedAnchorSetSha256: {
              $ref: "#/components/schemas/Sha256Hex",
            },
            minimumTrustedCount: { type: "integer", minimum: 0 },
            requiredTrustedKeyIds: {
              type: "array",
              maxItems: 32,
              uniqueItems: true,
              items: { $ref: "#/components/schemas/Sha256Hex" },
            },
          },
        },
        ReceiptTrustAnchorDirectoryVerificationStatus: {
          type: "string",
          enum: ["valid", "invalid"],
        },
        ReceiptTrustAnchorDirectoryVerification: {
          type: "object",
          required: [
            "kind",
            "schemaVersion",
            "apiVersion",
            "generatedAt",
            "status",
            "diagnostics",
            "contentSha256",
          ],
          additionalProperties: false,
          properties: {
            kind: {
              const: "napier.receipt-trust-anchor-directory-verification",
            },
            schemaVersion: { const: 1 },
            apiVersion: { type: "string", minLength: 1 },
            generatedAt: { type: "string", format: "date-time" },
            status: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryVerificationStatus",
            },
            diagnostics: {
              type: "array",
              items: { type: "string" },
            },
            policy: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryVerificationPolicy",
            },
            policySha256: { $ref: "#/components/schemas/Sha256Hex" },
            directoryGeneratedAt: { type: "string", format: "date-time" },
            directoryAgeMs: { type: "integer" },
            declaredContentSha256: { $ref: "#/components/schemas/Sha256Hex" },
            recomputedContentSha256: {
              $ref: "#/components/schemas/Sha256Hex",
            },
            declaredAnchorSetSha256: {
              $ref: "#/components/schemas/Sha256Hex",
            },
            recomputedAnchorSetSha256: {
              $ref: "#/components/schemas/Sha256Hex",
            },
            anchorCount: { type: "integer", minimum: 0 },
            trustedCount: { type: "integer", minimum: 0 },
            revokedCount: { type: "integer", minimum: 0 },
            contentSha256: { $ref: "#/components/schemas/Sha256Hex" },
          },
        },
        ReceiptTrustAnchorDirectoryDiscovery: {
          type: "object",
          required: [
            "kind",
            "schemaVersion",
            "apiVersion",
            "generatedAt",
            "status",
            "sourceUrlSha256",
            "sourceOriginSha256",
            "httpStatus",
            "responseMediaType",
            "responseBytes",
            "responseBodySha256",
            "verification",
            "contentSha256",
          ],
          additionalProperties: false,
          properties: {
            kind: {
              const: "napier.receipt-trust-anchor-directory-discovery",
            },
            schemaVersion: { const: 1 },
            apiVersion: { type: "string", minLength: 1 },
            generatedAt: { type: "string", format: "date-time" },
            status: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryVerificationStatus",
            },
            sourceUrlSha256: { $ref: "#/components/schemas/Sha256Hex" },
            sourceOriginSha256: { $ref: "#/components/schemas/Sha256Hex" },
            httpStatus: { type: "integer", minimum: 100, maximum: 599 },
            responseMediaType: { type: "string", minLength: 1 },
            responseBytes: { type: "integer", minimum: 0 },
            responseBodySha256: { $ref: "#/components/schemas/Sha256Hex" },
            verification: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryVerification",
            },
            directory: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectory",
            },
            contentSha256: { $ref: "#/components/schemas/Sha256Hex" },
          },
        },
        ReceiptTrustAnchorDirectoryMetadataReceipt: {
          type: "object",
          required: [
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
            "contentSha256",
          ],
          additionalProperties: false,
          properties: {
            kind: {
              const: "napier.receipt-trust-anchor-directory-metadata-receipt",
            },
            schemaVersion: { const: 1 },
            apiVersion: { type: "string", minLength: 1 },
            generatedAt: { type: "string", format: "date-time" },
            publisher: { type: "string", minLength: 1, maxLength: 120 },
            directorySha256: { $ref: "#/components/schemas/Sha256Hex" },
            anchorSetSha256: { $ref: "#/components/schemas/Sha256Hex" },
            anchorCount: { type: "integer", minimum: 0 },
            trustedCount: { type: "integer", minimum: 0 },
            revokedCount: { type: "integer", minimum: 0 },
            sourceUrlSha256: { $ref: "#/components/schemas/Sha256Hex" },
            sourceOriginSha256: { $ref: "#/components/schemas/Sha256Hex" },
            expiresAt: { type: "string", format: "date-time" },
            contentSha256: { $ref: "#/components/schemas/Sha256Hex" },
          },
        },
        TrustedReceiptSignature: {
          type: "object",
          required: [
            "algorithm",
            "keyId",
            "signedAt",
            "receiptArtifactSha256",
            "statementSha256",
            "value",
          ],
          additionalProperties: false,
          properties: {
            algorithm: { const: "Ed25519" },
            keyId: { $ref: "#/components/schemas/Sha256Hex" },
            signedAt: { type: "string", format: "date-time" },
            receiptArtifactSha256: {
              $ref: "#/components/schemas/Sha256Hex",
            },
            statementSha256: { $ref: "#/components/schemas/Sha256Hex" },
            value: {
              type: "string",
              minLength: 1,
              maxLength: 128,
              pattern: "^[A-Za-z0-9_-]+$",
            },
          },
        },
        ReceiptTrustAnchorDirectoryMetadataEnvelope: {
          type: "object",
          required: [
            "kind",
            "schemaVersion",
            "apiVersion",
            "receiptKind",
            "receipt",
            "signature",
            "contentSha256",
          ],
          additionalProperties: false,
          properties: {
            kind: { const: "napier.trusted-receipt-envelope" },
            schemaVersion: { const: 1 },
            apiVersion: { type: "string", minLength: 1 },
            receiptKind: { const: "receipt_trust_anchor_directory_metadata" },
            receipt: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryMetadataReceipt",
            },
            signature: {
              $ref: "#/components/schemas/TrustedReceiptSignature",
            },
            contentSha256: { $ref: "#/components/schemas/Sha256Hex" },
          },
        },
        TrustedReceiptVerificationStatus: {
          type: "string",
          enum: ["trusted", "revoked", "unknown_key", "invalid"],
        },
        TrustedReceiptAnchorDirectorySource: {
          type: "string",
          enum: ["uploaded", "active_selection"],
        },
        TrustedReceiptVerification: {
          type: "object",
          required: [
            "status",
            "verifiedAt",
            "signatureValid",
            "integrityValid",
            "reason",
          ],
          additionalProperties: false,
          properties: {
            status: {
              $ref: "#/components/schemas/TrustedReceiptVerificationStatus",
            },
            verifiedAt: { type: "string", format: "date-time" },
            receiptKind: { $ref: "#/components/schemas/TrustedReceiptKind" },
            receiptContentSha256: { $ref: "#/components/schemas/Sha256Hex" },
            receiptArtifactSha256: { $ref: "#/components/schemas/Sha256Hex" },
            keyId: { $ref: "#/components/schemas/Sha256Hex" },
            envelopeSha256: { $ref: "#/components/schemas/Sha256Hex" },
            anchorDirectorySha256: { $ref: "#/components/schemas/Sha256Hex" },
            anchorDirectoryVerificationSha256: {
              $ref: "#/components/schemas/Sha256Hex",
            },
            anchorDirectoryPolicySha256: {
              $ref: "#/components/schemas/Sha256Hex",
            },
            anchorDirectoryGeneratedAt: {
              type: "string",
              format: "date-time",
            },
            anchorDirectoryAgeMs: { type: "integer" },
            anchorDirectoryAnchorCount: { type: "integer", minimum: 0 },
            anchorDirectorySource: {
              $ref: "#/components/schemas/TrustedReceiptAnchorDirectorySource",
            },
            anchorDirectorySelectionId: {
              type: "string",
              pattern: "^sel_[a-z0-9]{8,80}$",
            },
            anchorDirectorySelectionSha256: {
              $ref: "#/components/schemas/Sha256Hex",
            },
            anchorDirectorySelectionStateSha256: {
              $ref: "#/components/schemas/Sha256Hex",
            },
            signatureValid: { type: "boolean" },
            integrityValid: { type: "boolean" },
            reason: { type: "string" },
          },
        },
        ReceiptTrustAnchorDirectoryMetadataVerification: {
          type: "object",
          required: [
            "kind",
            "schemaVersion",
            "apiVersion",
            "generatedAt",
            "status",
            "diagnostics",
            "trustedReceiptVerification",
            "directoryVerification",
            "signatureValid",
            "integrityValid",
            "directoryBindingValid",
            "contentSha256",
          ],
          additionalProperties: false,
          properties: {
            kind: {
              const:
                "napier.receipt-trust-anchor-directory-metadata-verification",
            },
            schemaVersion: { const: 1 },
            apiVersion: { type: "string", minLength: 1 },
            generatedAt: { type: "string", format: "date-time" },
            status: {
              $ref: "#/components/schemas/TrustedReceiptVerificationStatus",
            },
            diagnostics: {
              type: "array",
              items: { type: "string" },
            },
            trustedReceiptVerification: {
              $ref: "#/components/schemas/TrustedReceiptVerification",
            },
            directoryVerification: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryVerification",
            },
            trustDirectoryVerification: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryVerification",
            },
            metadata: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryMetadataReceipt",
            },
            publisher: { type: "string", minLength: 1, maxLength: 120 },
            directorySha256: { $ref: "#/components/schemas/Sha256Hex" },
            anchorSetSha256: { $ref: "#/components/schemas/Sha256Hex" },
            signerKeyId: { $ref: "#/components/schemas/Sha256Hex" },
            envelopeSha256: { $ref: "#/components/schemas/Sha256Hex" },
            signatureValid: { type: "boolean" },
            integrityValid: { type: "boolean" },
            directoryBindingValid: { type: "boolean" },
            expiresAt: { type: "string", format: "date-time" },
            contentSha256: { $ref: "#/components/schemas/Sha256Hex" },
          },
        },
        ReceiptTrustAnchorSigningSource: {
          type: "object",
          required: ["type", "variable"],
          additionalProperties: false,
          properties: {
            type: { const: "environment" },
            variable: { $ref: "#/components/schemas/EnvironmentVariableName" },
          },
        },
        CreateReceiptTrustAnchorRequest: {
          type: "object",
          required: ["threadId", "label", "source"],
          additionalProperties: false,
          properties: {
            threadId: {
              type: "string",
              pattern: "^thread_[a-z0-9]{8,80}$",
            },
            label: { type: "string", minLength: 1, maxLength: 100 },
            source: {
              oneOf: [
                {
                  $ref: "#/components/schemas/CreateReceiptTrustAnchorEnvironmentSource",
                },
                {
                  $ref: "#/components/schemas/CreateReceiptTrustAnchorPublicKeySource",
                },
              ],
            },
          },
        },
        CreateReceiptTrustAnchorEnvironmentSource: {
          type: "object",
          required: ["type", "variable"],
          additionalProperties: false,
          properties: {
            type: { const: "environment" },
            variable: { $ref: "#/components/schemas/EnvironmentVariableName" },
          },
        },
        CreateReceiptTrustAnchorPublicKeySource: {
          type: "object",
          required: ["type", "publicKeySpki"],
          additionalProperties: false,
          properties: {
            type: { const: "public_key" },
            publicKeySpki: {
              type: "string",
              minLength: 1,
              maxLength: 4096,
            },
          },
        },
        RevokeReceiptTrustAnchorRequest: {
          type: "object",
          required: ["threadId"],
          additionalProperties: false,
          properties: {
            threadId: {
              type: "string",
              pattern: "^thread_[a-z0-9]{8,80}$",
            },
          },
        },
        VerifyReceiptTrustAnchorDirectoryRequest: {
          type: "object",
          required: ["directory"],
          additionalProperties: false,
          properties: {
            directory: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectory",
            },
            policy: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryVerificationPolicy",
            },
          },
        },
        DiscoverReceiptTrustAnchorDirectoryRequest: {
          type: "object",
          required: ["sourceUrl"],
          additionalProperties: false,
          properties: {
            sourceUrl: { type: "string", minLength: 1, maxLength: 2048 },
            policy: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryVerificationPolicy",
            },
          },
        },
        SignReceiptTrustAnchorDirectoryMetadataRequest: {
          type: "object",
          required: ["trustAnchorId", "threadId", "publisher"],
          additionalProperties: false,
          dependentRequired: {
            sourceUrlSha256: ["sourceOriginSha256"],
            sourceOriginSha256: ["sourceUrlSha256"],
          },
          properties: {
            trustAnchorId: {
              type: "string",
              pattern: "^trustkey_[a-z0-9]{8,80}$",
            },
            threadId: {
              type: "string",
              pattern: "^thread_[a-z0-9]{8,80}$",
            },
            publisher: { type: "string", minLength: 1, maxLength: 120 },
            sourceUrlSha256: { $ref: "#/components/schemas/Sha256Hex" },
            sourceOriginSha256: { $ref: "#/components/schemas/Sha256Hex" },
            expiresAt: { type: "string", format: "date-time" },
          },
        },
        VerifyReceiptTrustAnchorDirectoryMetadataRequest: {
          type: "object",
          required: ["envelope", "directory"],
          additionalProperties: false,
          properties: {
            envelope: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryMetadataEnvelope",
            },
            directory: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectory",
            },
            directoryPolicy: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryVerificationPolicy",
            },
            trustDirectory: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectory",
            },
            trustDirectoryPolicy: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryVerificationPolicy",
            },
          },
        },
        TrustedReceiptKind: {
          type: "string",
          enum: [
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
          ],
        },
        EnvironmentVariableName: {
          type: "string",
          pattern: "^[A-Z_][A-Z0-9_]{1,127}$",
        },
        Sha256Hex: {
          type: "string",
          pattern: "^[a-f0-9]{64}$",
        },
      },
      responses: {
        ErrorResponse: {
          description: "Fail-closed JSON error response",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
      },
    },
    "x-napier-artifact-kind": "management-openapi",
    "x-napier-source-path": toRepoRelativePath(repoRoot, absoluteSourcePath),
    "x-napier-source-sha256": sha256Text(sourceText),
    "x-napier-route-count": routes.length,
    "x-napier-route-set-sha256": routeSetSha256,
  };
  return {
    artifact,
    artifactText: `${JSON.stringify(artifact, null, 2)}\n`,
    routeCount: routes.length,
    routeSetSha256,
    sourceSha256: artifact["x-napier-source-sha256"],
  };
}

export function extractManagementRoutes(sourceText) {
  const routePattern =
    /app\.(get|post|put|delete|patch)\(\s*(["'`])(\/api\/[^"'`]+)\2/g;
  const routes = [];
  const seen = new Set();
  for (const match of sourceText.matchAll(routePattern)) {
    const method = match[1].toLowerCase();
    const rawPath = match[3];
    const openapiPath = rawPath.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, "{$1}");
    const key = `${method.toUpperCase()} ${openapiPath}`;
    if (seen.has(key)) {
      throw new Error(`Duplicate management route: ${key}`);
    }
    seen.add(key);
    routes.push({
      method,
      rawPath,
      openapiPath,
      operationId: createOperationId(method, openapiPath),
      pathParams: Array.from(openapiPath.matchAll(/\{([^}]+)\}/g)).map(
        (paramMatch) => paramMatch[1],
      ),
      tag: createTag(openapiPath),
    });
  }
  routes.sort((left, right) => {
    const pathOrder = left.openapiPath.localeCompare(right.openapiPath);
    if (pathOrder !== 0) return pathOrder;
    return left.method.localeCompare(right.method);
  });
  const operationIds = new Set();
  for (const route of routes) {
    if (operationIds.has(route.operationId)) {
      throw new Error(`Duplicate management operationId: ${route.operationId}`);
    }
    operationIds.add(route.operationId);
  }
  if (routes.length === 0) {
    throw new Error("No /api management routes were found");
  }
  return routes;
}

async function runCli() {
  const options = parseCliOptions(process.argv.slice(2));
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const artifactPath = resolveRepoRelativePath(
    repoRoot,
    options.artifactPath ?? defaultArtifactPath,
    "artifactPath",
  );
  const generated = await generateManagementOpenApi(options);
  if (options.check) {
    const current = await readFile(artifactPath, "utf8").catch(() => "");
    if (current !== generated.artifactText) {
      console.error(
        `${toRepoRelativePath(repoRoot, artifactPath)} is stale; run npm run write:management-openapi.`,
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      `Management OpenAPI artifact is current: ${generated.routeCount} routes set ${generated.routeSetSha256.slice(0, 16)}`,
    );
    return;
  }
  if (options.json) {
    console.log(generated.artifactText.trimEnd());
    return;
  }
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, generated.artifactText);
  console.log(
    `Wrote ${toRepoRelativePath(repoRoot, artifactPath)}: ${generated.routeCount} routes set ${generated.routeSetSha256.slice(0, 16)}`,
  );
}

function createOperation(route) {
  const operation = {
    operationId: route.operationId,
    tags: [route.tag],
    summary: `${route.method.toUpperCase()} ${route.openapiPath}`,
    ...(route.pathParams.length > 0
      ? {
          parameters: route.pathParams.map((name) => ({
            name,
            in: "path",
            required: true,
            schema: { type: "string" },
          })),
        }
      : {}),
    ...(route.method === "post" ||
    route.method === "put" ||
    route.method === "patch"
      ? {
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: true,
              },
            },
          },
        }
      : {}),
    responses: {
      200: {
        description: "Successful no-store JSON response",
        content: {
          "application/json": {
            schema: true,
          },
        },
      },
      400: { $ref: "#/components/responses/ErrorResponse" },
      404: { $ref: "#/components/responses/ErrorResponse" },
      409: { $ref: "#/components/responses/ErrorResponse" },
      413: { $ref: "#/components/responses/ErrorResponse" },
    },
    "x-napier-source-route": `${route.method.toUpperCase()} ${route.rawPath}`,
  };
  return applyPromotedOperationSchemas(route, operation);
}

function applyPromotedOperationSchemas(route, operation) {
  const overlay =
    PROMOTED_OPERATION_SCHEMAS[
      `${route.method.toUpperCase()} ${route.openapiPath}`
    ];
  if (!overlay) return operation;
  let promotedRequestSchemaRef;
  if (overlay.request) {
    operation.requestBody ??= {
      required: true,
      content: {
        "application/json": {},
      },
    };
    operation.requestBody.content ??= {};
    operation.requestBody.required = true;
    operation.requestBody.content["application/json"] ??= {};
    operation.requestBody.content["application/json"].schema = {
      $ref: overlay.request,
    };
    promotedRequestSchemaRef = overlay.request;
  }
  const promotedResponseSchemaRefs = {};
  for (const [status, schemaRef] of Object.entries(overlay.responses ?? {})) {
    operation.responses[status] ??= {
      description: `Successful ${status} no-store JSON response`,
      content: {
        "application/json": {},
      },
    };
    const response = operation.responses[status];
    if (!isRecord(response)) continue;
    response.content ??= {};
    response.content["application/json"] ??= {};
    response.content["application/json"].schema = { $ref: schemaRef };
    promotedResponseSchemaRefs[status] = schemaRef;
  }
  return {
    ...operation,
    ...(promotedRequestSchemaRef
      ? { "x-napier-promoted-request-schema-ref": promotedRequestSchemaRef }
      : {}),
    "x-napier-promoted-response-schema-refs": promotedResponseSchemaRefs,
  };
}

function createOperationId(method, openapiPath) {
  const suffix = openapiPath
    .replace(/^\/api\/?/, "")
    .replace(/\{([^}]+)\}/g, "by-$1")
    .split("/")
    .filter(Boolean)
    .map((part) => part.replace(/[^A-Za-z0-9]+/g, "-"))
    .filter(Boolean)
    .join("-");
  return `${method}-${suffix || "root"}`;
}

function createTag(openapiPath) {
  const parts = openapiPath.split("/").filter(Boolean);
  if (parts[1] === "receipt-trust") return "receipt-trust";
  if (parts[1] === "threads") return "threads";
  if (parts[1] === "plan-blueprints") return "plan-blueprints";
  return parts[1] ?? "management";
}

function parseCliOptions(args) {
  const options = { check: false, json: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--check") {
      options.check = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--repo-root") {
      options.repoRoot = readCliValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--source-path") {
      options.sourcePath = readCliValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--artifact-path") {
      options.artifactPath = readCliValue(args, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function readCliValue(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function resolveRepoRelativePath(repoRoot, inputPath, label) {
  const absolutePath = path.resolve(repoRoot, inputPath);
  const relativePath = path.relative(repoRoot, absolutePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`${label} must stay inside the repository`);
  }
  return absolutePath;
}

function toRepoRelativePath(repoRoot, filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join("/");
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
