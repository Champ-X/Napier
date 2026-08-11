import {
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";

import {
  canonicalJson,
  ed25519KeyId,
  exportEd25519PublicKeySpki,
  sha256,
  signEd25519Statement,
  verifyEd25519Statement,
} from "../packages/runtime/dist/index.js";

const PLATFORMS = ["linux/amd64", "linux/arm64"];
const DSSE_PAYLOAD_TYPE = "application/vnd.in-toto+json";
const BUILD_TYPE = "https://napier.local/buildkit/oci-layout/v1";

export function signSandboxOciPublication(publication, source) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeySpki = exportEd25519PublicKeySpki(publicKey);
  const keyId = ed25519KeyId(publicKeySpki);
  const statement = {
    kind: "napier.sandbox-oci-index-signature-statement",
    schemaVersion: 1,
    subject: {
      name: "napier-sandbox",
      digest: publication.imageIndexDigest,
    },
    source,
    platformSetSha256: sha256(
      canonicalJson(publication.platforms.map((item) => item.platform)),
    ),
    publicationEvidenceSha256: publication.evidenceSha256,
  };
  const signature = signEd25519Statement(statement, privateKey);
  if (!verifyEd25519Statement(statement, signature, publicKey)) {
    throw new Error("Ephemeral OCI index signature verification failed");
  }
  return {
    algorithm: "Ed25519",
    keyOrigin: "ephemeral-memory",
    keyId,
    publicKeySpki,
    statement,
    signature,
    verified: true,
    privateKeyRetained: false,
    transparencyLogRecorded: false,
  };
}

export function attestSandboxOciPublication(input) {
  const statement = {
    _type: "https://in-toto.io/Statement/v1",
    subject: [
      {
        name: "napier-sandbox",
        digest: {
          sha256: input.publication.imageIndexDigest.slice("sha256:".length),
        },
      },
    ],
    predicateType: "https://slsa.dev/provenance/v1",
    predicate: {
      buildDefinition: {
        buildType: BUILD_TYPE,
        externalParameters: {
          platforms: [...PLATFORMS],
          source: input.source,
        },
        internalParameters: {
          externalRegistryPublished: false,
          buildkitProvenanceEmbedded: false,
          sbomEmbedded: false,
        },
        resolvedDependencies: [],
      },
      runDetails: {
        builder: {
          id: `napier:buildkit:${input.builder.identitySha256}`,
        },
        metadata: {
          invocationId: sha256(
            canonicalJson({
              publication: input.publication.evidenceSha256,
              startedOn: input.startedAt.toISOString(),
            }),
          ),
          startedOn: input.startedAt.toISOString(),
          finishedOn: input.finishedAt.toISOString(),
        },
      },
    },
  };
  const payload = Buffer.from(canonicalJson(statement));
  const { privateKey } = generateKeyPairSync("ed25519");
  const publicKey = createPublicKey(privateKey);
  const publicKeySpki = exportEd25519PublicKeySpki(publicKey);
  const keyId = ed25519KeyId(publicKeySpki);
  const signature = sign(null, dssePae(DSSE_PAYLOAD_TYPE, payload), privateKey);
  if (
    !verify(null, dssePae(DSSE_PAYLOAD_TYPE, payload), publicKey, signature)
  ) {
    throw new Error("Local DSSE attestation verification failed");
  }
  const envelope = {
    payloadType: DSSE_PAYLOAD_TYPE,
    payload: payload.toString("base64"),
    signatures: [{ keyid: keyId, sig: signature.toString("base64") }],
  };
  return {
    format: "DSSE",
    statementType: statement._type,
    predicateType: statement.predicateType,
    keyOrigin: "ephemeral-memory",
    keyId,
    publicKeySpki,
    envelope,
    envelopeSha256: sha256(canonicalJson(envelope)),
    verified: true,
    privateKeyRetained: false,
    externalAttestation: false,
  };
}

function dssePae(payloadType, payload) {
  return Buffer.concat([
    Buffer.from(
      `DSSEv1 ${Buffer.byteLength(payloadType, "utf8")} ${payloadType} ${payload.byteLength} `,
    ),
    payload,
  ]);
}
