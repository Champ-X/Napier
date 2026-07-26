import type {
  InboundDeadLetterRetryCandidate,
  InboundDeadLetterRetryHistory,
  InboundDeadLetterRetryHistoryVerification,
  InboundDeadLetterRetryPreview,
  InboundDelivery,
  InboundDeadLetterExportVerification,
  InboundDeliveryQualificationStatus,
  RunEvent,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";

const MAX_VERIFICATION_DIAGNOSTICS = 40;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const TOP_LEVEL_KEYS = new Set([
  "schemaVersion",
  "exportedAt",
  "channel",
  "currentAdapterCatalogSha256",
  "qualifiedCount",
  "evidenceMissingCount",
  "adapterCatalogDriftCount",
  "deliveryCount",
  "deliveries",
  "contentSha256",
]);
const CHANNEL_KEYS = new Set([
  "id",
  "name",
  "threadId",
  "status",
  "retryPolicy",
  "revision",
]);
const RETRY_POLICY_KEYS = new Set(["maxAttempts", "baseDelayMs"]);
const DELIVERY_KEYS = new Set([
  "deliveryId",
  "threadId",
  "idempotencyFingerprint",
  "triggerId",
  "attemptCount",
  "maxAttempts",
  "retryBaseMs",
  "retryDisposition",
  "qualificationStatus",
  "messageSha256",
  "bodySha256",
  "adapterCatalogSha256",
  "error",
  "runId",
  "createdAt",
  "lastAttemptAt",
  "finishedAt",
]);
const RETRY_HISTORY_KEYS = new Set([
  "schemaVersion",
  "channelId",
  "eventCount",
  "fromSeq",
  "toSeq",
  "eventSetSha256",
  "records",
  "contentSha256",
]);
const RETRY_HISTORY_RECORD_KEYS = new Set([
  "eventId",
  "seq",
  "createdAt",
  "channelId",
  "applyResultSha256",
  "previewSha256",
  "artifactSha256",
  "previewCandidateSetSha256",
  "previewRetryableDeliveryIdsSha256",
  "previewBlockedDeliveryIdsSha256",
  "retriedCount",
  "skippedCount",
  "retriedDeliveryIdsSha256",
  "skippedDeliveryIdsSha256",
]);

export interface VerifyInboundDeadLetterExportOptions {
  expectedChannelId?: string;
}

export interface PreviewInboundDeadLetterRetryOptions {
  expectedChannelId: string;
}

export interface VerifyInboundDeadLetterRetryHistoryOptions {
  expectedChannelId: string;
  events: readonly RunEvent[];
}

export function verifyInboundDeadLetterExportArtifact(
  artifact: unknown,
  options: VerifyInboundDeadLetterExportOptions = {},
): InboundDeadLetterExportVerification {
  const diagnostics: string[] = [];
  let channelId: string | undefined;
  let declaredContentSha256: string | undefined;
  let recomputedContentSha256: string | undefined;
  let deliveryCount: number | undefined;
  let observedDeliveryCount: number | undefined;
  let qualifiedCount: number | undefined;
  let evidenceMissingCount: number | undefined;
  let adapterCatalogDriftCount: number | undefined;
  let observedQualifiedCount: number | undefined;
  let observedEvidenceMissingCount: number | undefined;
  let observedAdapterCatalogDriftCount: number | undefined;

  const addDiagnostic = (message: string): void => {
    if (diagnostics.length < MAX_VERIFICATION_DIAGNOSTICS) {
      diagnostics.push(message);
    }
  };

  if (!isRecord(artifact)) {
    addDiagnostic("Dead-letter export must be a JSON object.");
  } else {
    reportUnknownKeys(artifact, TOP_LEVEL_KEYS, "Artifact", addDiagnostic);
    if (artifact["schemaVersion"] !== 1) {
      addDiagnostic("Dead-letter export schemaVersion must be 1.");
    }
    if (!isIsoString(artifact["exportedAt"])) {
      addDiagnostic("Dead-letter export exportedAt must be an ISO timestamp.");
    }

    const channel = artifact["channel"];
    if (!isRecord(channel)) {
      addDiagnostic("Dead-letter export channel must be an object.");
    } else {
      reportUnknownKeys(channel, CHANNEL_KEYS, "Channel", addDiagnostic);
      if (typeof channel["id"] === "string") {
        channelId = channel["id"];
      } else {
        addDiagnostic("Dead-letter export channel.id must be a string.");
      }
      if (typeof channel["name"] !== "string") {
        addDiagnostic("Dead-letter export channel.name must be a string.");
      }
      if (typeof channel["threadId"] !== "string") {
        addDiagnostic("Dead-letter export channel.threadId must be a string.");
      }
      if (channel["status"] !== "active" && channel["status"] !== "paused") {
        addDiagnostic("Dead-letter export channel.status is invalid.");
      }
      if (!isNonNegativeInteger(channel["revision"])) {
        addDiagnostic(
          "Dead-letter export channel.revision must be a non-negative integer.",
        );
      }
      const retryPolicy = channel["retryPolicy"];
      if (!isRecord(retryPolicy)) {
        addDiagnostic(
          "Dead-letter export channel.retryPolicy must be an object.",
        );
      } else {
        reportUnknownKeys(
          retryPolicy,
          RETRY_POLICY_KEYS,
          "Retry policy",
          addDiagnostic,
        );
        if (!isPositiveInteger(retryPolicy["maxAttempts"])) {
          addDiagnostic(
            "Dead-letter export retryPolicy.maxAttempts must be a positive integer.",
          );
        }
        if (!isPositiveInteger(retryPolicy["baseDelayMs"])) {
          addDiagnostic(
            "Dead-letter export retryPolicy.baseDelayMs must be a positive integer.",
          );
        }
      }
    }

    if (
      options.expectedChannelId !== undefined &&
      channelId !== options.expectedChannelId
    ) {
      addDiagnostic("Dead-letter export channel does not match this endpoint.");
    }

    const currentAdapterCatalogSha256 = readOptionalSha256(
      artifact,
      "currentAdapterCatalogSha256",
      addDiagnostic,
    );
    declaredContentSha256 = readOptionalSha256(
      artifact,
      "contentSha256",
      addDiagnostic,
    );
    deliveryCount = readOptionalNonNegativeInteger(
      artifact,
      "deliveryCount",
      addDiagnostic,
    );
    qualifiedCount = readOptionalNonNegativeInteger(
      artifact,
      "qualifiedCount",
      addDiagnostic,
    );
    evidenceMissingCount = readOptionalNonNegativeInteger(
      artifact,
      "evidenceMissingCount",
      addDiagnostic,
    );
    adapterCatalogDriftCount = readOptionalNonNegativeInteger(
      artifact,
      "adapterCatalogDriftCount",
      addDiagnostic,
    );

    if (deliveryCount === undefined) {
      addDiagnostic("Dead-letter export deliveryCount is required.");
    }
    if (!declaredContentSha256) {
      addDiagnostic("Dead-letter export contentSha256 is required.");
    }

    const deliveries = artifact["deliveries"];
    if (!Array.isArray(deliveries)) {
      addDiagnostic("Dead-letter export deliveries must be an array.");
    } else {
      observedDeliveryCount = deliveries.length;
      const observed = summarizeDeliveries(
        deliveries,
        currentAdapterCatalogSha256,
        addDiagnostic,
      );
      observedQualifiedCount = observed.qualifiedCount;
      observedEvidenceMissingCount = observed.evidenceMissingCount;
      observedAdapterCatalogDriftCount = observed.adapterCatalogDriftCount;
      if (
        deliveryCount !== undefined &&
        deliveryCount !== observedDeliveryCount
      ) {
        addDiagnostic(
          "Dead-letter export deliveryCount does not match deliveries length.",
        );
      }
      if (currentAdapterCatalogSha256) {
        if (
          qualifiedCount === undefined ||
          evidenceMissingCount === undefined ||
          adapterCatalogDriftCount === undefined
        ) {
          addDiagnostic(
            "Dead-letter export qualification summary counts are required when currentAdapterCatalogSha256 is present.",
          );
        }
        if (
          qualifiedCount !== undefined &&
          qualifiedCount !== observedQualifiedCount
        ) {
          addDiagnostic(
            "Dead-letter export qualifiedCount does not match delivery statuses.",
          );
        }
        if (
          evidenceMissingCount !== undefined &&
          evidenceMissingCount !== observedEvidenceMissingCount
        ) {
          addDiagnostic(
            "Dead-letter export evidenceMissingCount does not match delivery statuses.",
          );
        }
        if (
          adapterCatalogDriftCount !== undefined &&
          adapterCatalogDriftCount !== observedAdapterCatalogDriftCount
        ) {
          addDiagnostic(
            "Dead-letter export adapterCatalogDriftCount does not match delivery statuses.",
          );
        }
      } else if (
        qualifiedCount !== undefined ||
        evidenceMissingCount !== undefined ||
        adapterCatalogDriftCount !== undefined
      ) {
        addDiagnostic(
          "Dead-letter export summary counts require currentAdapterCatalogSha256.",
        );
      }
    }

    const {
      exportedAt: _exportedAt,
      contentSha256: _contentSha256,
      ...content
    } = artifact;
    recomputedContentSha256 = sha256(canonicalJson(content));
    if (
      declaredContentSha256 &&
      declaredContentSha256 !== recomputedContentSha256
    ) {
      addDiagnostic("Dead-letter export contentSha256 does not match content.");
    }
  }

  const status: InboundDeadLetterExportVerification["status"] =
    diagnostics.length === 0 ? "valid" : "invalid";
  const content = {
    schemaVersion: 1 as const,
    status,
    diagnostics,
    ...(channelId ? { channelId } : {}),
    ...(options.expectedChannelId
      ? { expectedChannelId: options.expectedChannelId }
      : {}),
    ...(declaredContentSha256 ? { declaredContentSha256 } : {}),
    ...(recomputedContentSha256 ? { recomputedContentSha256 } : {}),
    ...(deliveryCount !== undefined ? { deliveryCount } : {}),
    ...(observedDeliveryCount !== undefined ? { observedDeliveryCount } : {}),
    ...(qualifiedCount !== undefined ? { qualifiedCount } : {}),
    ...(observedQualifiedCount !== undefined ? { observedQualifiedCount } : {}),
    ...(evidenceMissingCount !== undefined ? { evidenceMissingCount } : {}),
    ...(observedEvidenceMissingCount !== undefined
      ? { observedEvidenceMissingCount }
      : {}),
    ...(adapterCatalogDriftCount !== undefined
      ? { adapterCatalogDriftCount }
      : {}),
    ...(observedAdapterCatalogDriftCount !== undefined
      ? { observedAdapterCatalogDriftCount }
      : {}),
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function createInboundDeadLetterRetryPreview(
  artifact: unknown,
  liveDeliveries: readonly InboundDelivery[],
  options: PreviewInboundDeadLetterRetryOptions,
): InboundDeadLetterRetryPreview {
  const verification = verifyInboundDeadLetterExportArtifact(artifact, {
    expectedChannelId: options.expectedChannelId,
  });
  const artifactSha256 =
    verification.declaredContentSha256 ?? verification.recomputedContentSha256;
  const diagnostics =
    verification.status === "valid" ? [] : verification.diagnostics;
  const liveById = new Map(
    liveDeliveries.map((delivery) => [delivery.id, delivery] as const),
  );
  const candidates =
    verification.status === "valid"
      ? artifactDeliveryRecords(artifact).map((delivery) =>
          retryCandidateFromArtifactDelivery(
            delivery,
            liveById.get(String(delivery["deliveryId"])),
            options.expectedChannelId,
          ),
        )
      : [];
  const retryableCount = candidates.filter(
    (candidate) => candidate.status === "retryable",
  ).length;
  const blockedCount = candidates.length - retryableCount;
  const retryableDeliveryIds = candidates
    .filter((candidate) => candidate.status === "retryable")
    .map((candidate) => candidate.deliveryId);
  const blockedDeliveryIds = candidates
    .filter((candidate) => candidate.status !== "retryable")
    .map((candidate) => candidate.deliveryId);
  const content = {
    schemaVersion: 1 as const,
    channelId: options.expectedChannelId,
    verificationStatus: verification.status,
    ...(artifactSha256 ? { artifactSha256 } : {}),
    retryableCount,
    blockedCount,
    candidateSetSha256: hashRetryCandidates(candidates),
    retryableDeliveryIdsSha256: hashDeliveryIds(retryableDeliveryIds),
    blockedDeliveryIdsSha256: hashDeliveryIds(blockedDeliveryIds),
    diagnostics,
    candidates,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function createInboundDeadLetterRetryHistory(
  channelId: string,
  events: readonly RunEvent[],
): InboundDeadLetterRetryHistory {
  const records = events
    .map((event) => retryHistoryRecordFromEvent(channelId, event))
    .filter((record) => record !== undefined);
  const content = {
    schemaVersion: 1 as const,
    channelId,
    eventCount: records.length,
    ...(records[0] ? { fromSeq: records[0].seq } : {}),
    ...(records.at(-1) ? { toSeq: records.at(-1)!.seq } : {}),
    eventSetSha256: hashRetryHistoryRecords(records),
    records,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function verifyInboundDeadLetterRetryHistory(
  history: unknown,
  options: VerifyInboundDeadLetterRetryHistoryOptions,
): InboundDeadLetterRetryHistoryVerification {
  const diagnostics: string[] = [];
  let channelId: string | undefined;
  let declaredContentSha256: string | undefined;
  let recomputedContentSha256: string | undefined;
  let declaredEventSetSha256: string | undefined;
  let eventCount: number | undefined;
  let fromSeq: number | undefined;
  let toSeq: number | undefined;
  const observed = createInboundDeadLetterRetryHistory(
    options.expectedChannelId,
    options.events,
  );

  const addDiagnostic = (message: string): void => {
    if (diagnostics.length < MAX_VERIFICATION_DIAGNOSTICS) {
      diagnostics.push(message);
    }
  };

  if (!isRecord(history)) {
    addDiagnostic("Dead-letter retry history must be a JSON object.");
  } else {
    reportUnknownKeys(
      history,
      RETRY_HISTORY_KEYS,
      "Retry history",
      addDiagnostic,
    );
    if (history["schemaVersion"] !== 1) {
      addDiagnostic("Dead-letter retry history schemaVersion must be 1.");
    }
    if (typeof history["channelId"] === "string") {
      channelId = history["channelId"];
      if (channelId !== options.expectedChannelId) {
        addDiagnostic("Dead-letter retry history channelId does not match.");
      }
    } else {
      addDiagnostic("Dead-letter retry history channelId must be a string.");
    }
    if (isNonNegativeInteger(history["eventCount"])) {
      eventCount = history["eventCount"];
    } else {
      addDiagnostic(
        "Dead-letter retry history eventCount must be a non-negative integer.",
      );
    }
    fromSeq = readOptionalNonNegativeInteger(history, "fromSeq", addDiagnostic);
    toSeq = readOptionalNonNegativeInteger(history, "toSeq", addDiagnostic);
    declaredEventSetSha256 = readOptionalSha256(
      history,
      "eventSetSha256",
      addDiagnostic,
    );
    if (!declaredEventSetSha256) {
      addDiagnostic("Dead-letter retry history eventSetSha256 is required.");
    }
    declaredContentSha256 = readOptionalSha256(
      history,
      "contentSha256",
      addDiagnostic,
    );
    if (!declaredContentSha256) {
      addDiagnostic("Dead-letter retry history contentSha256 is required.");
    }
    const records = history["records"];
    if (!Array.isArray(records)) {
      addDiagnostic("Dead-letter retry history records must be an array.");
    } else {
      const normalizedRecords = records
        .map((record, index) =>
          normalizeRetryHistoryRecord(record, index, channelId, addDiagnostic),
        )
        .filter((record) => record !== undefined);
      if (eventCount !== undefined && eventCount !== records.length) {
        addDiagnostic(
          "Dead-letter retry history eventCount does not match records length.",
        );
      }
      const expectedFromSeq = normalizedRecords[0]?.seq;
      const expectedToSeq = normalizedRecords.at(-1)?.seq;
      if (normalizedRecords.length === 0) {
        if (fromSeq !== undefined || toSeq !== undefined) {
          addDiagnostic(
            "Dead-letter retry history sequence bounds require at least one record.",
          );
        }
      } else {
        if (fromSeq !== expectedFromSeq) {
          addDiagnostic(
            "Dead-letter retry history fromSeq does not match records.",
          );
        }
        if (toSeq !== expectedToSeq) {
          addDiagnostic(
            "Dead-letter retry history toSeq does not match records.",
          );
        }
      }
      const recomputedEventSetSha256 =
        hashRetryHistoryRecords(normalizedRecords);
      if (
        declaredEventSetSha256 &&
        declaredEventSetSha256 !== recomputedEventSetSha256
      ) {
        addDiagnostic(
          "Dead-letter retry history eventSetSha256 does not match records.",
        );
      }
    }
    const { contentSha256: _contentSha256, ...content } = history;
    recomputedContentSha256 = sha256(canonicalJson(content));
    if (
      declaredContentSha256 &&
      declaredContentSha256 !== recomputedContentSha256
    ) {
      addDiagnostic(
        "Dead-letter retry history contentSha256 does not match content.",
      );
    }
  }

  if (
    declaredContentSha256 &&
    declaredContentSha256 !== observed.contentSha256
  ) {
    addDiagnostic(
      "Dead-letter retry history contentSha256 does not match current Ledger projection.",
    );
  }
  if (
    declaredEventSetSha256 &&
    declaredEventSetSha256 !== observed.eventSetSha256
  ) {
    addDiagnostic(
      "Dead-letter retry history eventSetSha256 does not match current Ledger projection.",
    );
  }
  if (eventCount !== undefined && eventCount !== observed.eventCount) {
    addDiagnostic(
      "Dead-letter retry history eventCount does not match current Ledger projection.",
    );
  }
  if (fromSeq !== observed.fromSeq) {
    addDiagnostic(
      "Dead-letter retry history fromSeq does not match current Ledger projection.",
    );
  }
  if (toSeq !== observed.toSeq) {
    addDiagnostic(
      "Dead-letter retry history toSeq does not match current Ledger projection.",
    );
  }

  const status: InboundDeadLetterRetryHistoryVerification["status"] =
    diagnostics.length === 0 ? "valid" : "invalid";
  const content = {
    schemaVersion: 1 as const,
    status,
    diagnostics,
    ...(channelId ? { channelId } : {}),
    expectedChannelId: options.expectedChannelId,
    ...(declaredContentSha256 ? { declaredContentSha256 } : {}),
    ...(recomputedContentSha256 ? { recomputedContentSha256 } : {}),
    observedContentSha256: observed.contentSha256,
    ...(declaredEventSetSha256 ? { declaredEventSetSha256 } : {}),
    observedEventSetSha256: observed.eventSetSha256,
    ...(eventCount !== undefined ? { eventCount } : {}),
    observedEventCount: observed.eventCount,
    ...(fromSeq !== undefined ? { fromSeq } : {}),
    ...(observed.fromSeq !== undefined
      ? { observedFromSeq: observed.fromSeq }
      : {}),
    ...(toSeq !== undefined ? { toSeq } : {}),
    ...(observed.toSeq !== undefined ? { observedToSeq: observed.toSeq } : {}),
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

function hashRetryCandidates(
  candidates: readonly InboundDeadLetterRetryCandidate[],
): string {
  return sha256(
    canonicalJson(
      candidates
        .map((candidate) => ({
          deliveryId: candidate.deliveryId,
          status: candidate.status,
        }))
        .sort(
          (left, right) =>
            left.deliveryId.localeCompare(right.deliveryId) ||
            left.status.localeCompare(right.status),
        ),
    ),
  );
}

function hashDeliveryIds(deliveryIds: readonly string[]): string {
  return sha256(canonicalJson([...deliveryIds].sort()));
}

function hashRetryHistoryRecords(
  records: readonly InboundDeadLetterRetryHistory["records"][number][],
): string {
  return sha256(
    canonicalJson(
      records
        .map((record) => ({
          eventId: record.eventId,
          seq: record.seq,
          createdAt: record.createdAt,
          ...(record.applyResultSha256
            ? { applyResultSha256: record.applyResultSha256 }
            : {}),
          previewSha256: record.previewSha256,
          ...(record.artifactSha256
            ? { artifactSha256: record.artifactSha256 }
            : {}),
          previewCandidateSetSha256: record.previewCandidateSetSha256,
          previewRetryableDeliveryIdsSha256:
            record.previewRetryableDeliveryIdsSha256,
          previewBlockedDeliveryIdsSha256:
            record.previewBlockedDeliveryIdsSha256,
          retriedCount: record.retriedCount,
          skippedCount: record.skippedCount,
          retriedDeliveryIdsSha256: record.retriedDeliveryIdsSha256,
          skippedDeliveryIdsSha256: record.skippedDeliveryIdsSha256,
        }))
        .sort(
          (left, right) =>
            left.seq - right.seq || left.eventId.localeCompare(right.eventId),
        ),
    ),
  );
}

function retryHistoryRecordFromEvent(
  channelId: string,
  event: RunEvent,
): InboundDeadLetterRetryHistory["records"][number] | undefined {
  if (
    event.type !== "channel.dead_letters.retry_applied" ||
    event.category !== "channel" ||
    !isRecord(event.payload) ||
    event.payload["channelId"] !== channelId
  ) {
    return undefined;
  }
  const applyResultSha256 = readSha256(event.payload["applyResultSha256"]);
  const previewSha256 = readSha256(event.payload["previewSha256"]);
  const artifactSha256 = readSha256(event.payload["artifactSha256"]);
  const previewCandidateSetSha256 = readSha256(
    event.payload["previewCandidateSetSha256"],
  );
  const previewRetryableDeliveryIdsSha256 = readSha256(
    event.payload["previewRetryableDeliveryIdsSha256"],
  );
  const previewBlockedDeliveryIdsSha256 = readSha256(
    event.payload["previewBlockedDeliveryIdsSha256"],
  );
  const retriedDeliveryIdsSha256 = readSha256(
    event.payload["retriedDeliveryIdsSha256"],
  );
  const skippedDeliveryIdsSha256 = readSha256(
    event.payload["skippedDeliveryIdsSha256"],
  );
  if (
    !previewSha256 ||
    !previewCandidateSetSha256 ||
    !previewRetryableDeliveryIdsSha256 ||
    !previewBlockedDeliveryIdsSha256 ||
    !retriedDeliveryIdsSha256 ||
    !skippedDeliveryIdsSha256 ||
    !isNonNegativeInteger(event.payload["retriedCount"]) ||
    !isNonNegativeInteger(event.payload["skippedCount"])
  ) {
    return undefined;
  }
  return {
    eventId: event.id,
    seq: event.seq,
    createdAt: event.createdAt,
    channelId,
    ...(applyResultSha256 ? { applyResultSha256 } : {}),
    previewSha256,
    ...(artifactSha256 ? { artifactSha256 } : {}),
    previewCandidateSetSha256,
    previewRetryableDeliveryIdsSha256,
    previewBlockedDeliveryIdsSha256,
    retriedCount: event.payload["retriedCount"],
    skippedCount: event.payload["skippedCount"],
    retriedDeliveryIdsSha256,
    skippedDeliveryIdsSha256,
  };
}

function normalizeRetryHistoryRecord(
  record: unknown,
  index: number,
  channelId: string | undefined,
  addDiagnostic: (message: string) => void,
): InboundDeadLetterRetryHistory["records"][number] | undefined {
  if (!isRecord(record)) {
    addDiagnostic(`Retry history record ${index} must be an object.`);
    return undefined;
  }
  reportUnknownKeys(
    record,
    RETRY_HISTORY_RECORD_KEYS,
    `Retry history record ${index}`,
    addDiagnostic,
  );
  const eventId = record["eventId"];
  const seq = record["seq"];
  const createdAt = record["createdAt"];
  const recordChannelId = record["channelId"];
  const previewSha256 = readOptionalSha256(
    record,
    "previewSha256",
    addDiagnostic,
  );
  const applyResultSha256 = readOptionalSha256(
    record,
    "applyResultSha256",
    addDiagnostic,
  );
  const artifactSha256 = readOptionalSha256(
    record,
    "artifactSha256",
    addDiagnostic,
  );
  const previewCandidateSetSha256 = readOptionalSha256(
    record,
    "previewCandidateSetSha256",
    addDiagnostic,
  );
  const previewRetryableDeliveryIdsSha256 = readOptionalSha256(
    record,
    "previewRetryableDeliveryIdsSha256",
    addDiagnostic,
  );
  const previewBlockedDeliveryIdsSha256 = readOptionalSha256(
    record,
    "previewBlockedDeliveryIdsSha256",
    addDiagnostic,
  );
  const retriedDeliveryIdsSha256 = readOptionalSha256(
    record,
    "retriedDeliveryIdsSha256",
    addDiagnostic,
  );
  const skippedDeliveryIdsSha256 = readOptionalSha256(
    record,
    "skippedDeliveryIdsSha256",
    addDiagnostic,
  );
  const retriedCount = record["retriedCount"];
  const skippedCount = record["skippedCount"];
  if (typeof eventId !== "string") {
    addDiagnostic(`Retry history record ${index} eventId must be a string.`);
  }
  if (!isNonNegativeInteger(seq)) {
    addDiagnostic(
      `Retry history record ${index} seq must be a non-negative integer.`,
    );
  }
  if (!isIsoString(createdAt)) {
    addDiagnostic(
      `Retry history record ${index} createdAt must be an ISO timestamp.`,
    );
  }
  if (typeof recordChannelId !== "string") {
    addDiagnostic(`Retry history record ${index} channelId must be a string.`);
  } else if (channelId && recordChannelId !== channelId) {
    addDiagnostic(
      `Retry history record ${index} channelId does not match history channelId.`,
    );
  }
  if (!isNonNegativeInteger(retriedCount)) {
    addDiagnostic(
      `Retry history record ${index} retriedCount must be a non-negative integer.`,
    );
  }
  if (!isNonNegativeInteger(skippedCount)) {
    addDiagnostic(
      `Retry history record ${index} skippedCount must be a non-negative integer.`,
    );
  }
  if (
    typeof eventId !== "string" ||
    !isNonNegativeInteger(seq) ||
    !isIsoString(createdAt) ||
    typeof recordChannelId !== "string" ||
    !previewSha256 ||
    !previewCandidateSetSha256 ||
    !previewRetryableDeliveryIdsSha256 ||
    !previewBlockedDeliveryIdsSha256 ||
    !isNonNegativeInteger(retriedCount) ||
    !isNonNegativeInteger(skippedCount) ||
    !retriedDeliveryIdsSha256 ||
    !skippedDeliveryIdsSha256
  ) {
    return undefined;
  }
  return {
    eventId,
    seq,
    createdAt,
    channelId: recordChannelId,
    ...(applyResultSha256 ? { applyResultSha256 } : {}),
    previewSha256,
    ...(artifactSha256 ? { artifactSha256 } : {}),
    previewCandidateSetSha256,
    previewRetryableDeliveryIdsSha256,
    previewBlockedDeliveryIdsSha256,
    retriedCount,
    skippedCount,
    retriedDeliveryIdsSha256,
    skippedDeliveryIdsSha256,
  };
}

function artifactDeliveryRecords(artifact: unknown): Record<string, unknown>[] {
  if (!isRecord(artifact) || !Array.isArray(artifact["deliveries"])) return [];
  return artifact["deliveries"].filter(isRecord);
}

function retryCandidateFromArtifactDelivery(
  artifactDelivery: Record<string, unknown>,
  liveDelivery: InboundDelivery | undefined,
  expectedChannelId: string,
): InboundDeadLetterRetryCandidate {
  const deliveryId =
    typeof artifactDelivery["deliveryId"] === "string"
      ? artifactDelivery["deliveryId"]
      : "unknown";
  if (!liveDelivery) {
    return {
      deliveryId,
      status: "not_found",
      diagnostics: ["Delivery is not present in the current channel store."],
      ...artifactDeliveryEvidence(artifactDelivery),
    };
  }
  const base = {
    deliveryId,
    idempotencyFingerprint: liveDelivery.idempotencyFingerprint,
    attemptCount: liveDelivery.attemptCount,
    maxAttempts: liveDelivery.maxAttempts,
    ...(liveDelivery.bodySha256 ? { bodySha256: liveDelivery.bodySha256 } : {}),
    ...(liveDelivery.adapterCatalogSha256
      ? { adapterCatalogSha256: liveDelivery.adapterCatalogSha256 }
      : {}),
  };
  if (liveDelivery.channelId !== expectedChannelId) {
    return {
      ...base,
      status: "not_found",
      diagnostics: ["Delivery belongs to a different inbound channel."],
    };
  }
  if (liveDelivery.status !== "failed") {
    return {
      ...base,
      status: "not_failed",
      diagnostics: [`Delivery is ${liveDelivery.status}, not failed.`],
    };
  }
  if (liveDelivery.attemptCount >= liveDelivery.maxAttempts) {
    return {
      ...base,
      status: "retry_exhausted",
      diagnostics: ["Delivery retry limit is exhausted."],
    };
  }
  return {
    ...base,
    status: "retryable",
    diagnostics: [],
  };
}

function artifactDeliveryEvidence(
  artifactDelivery: Record<string, unknown>,
): Partial<InboundDeadLetterRetryCandidate> {
  const idempotencyFingerprint = artifactDelivery["idempotencyFingerprint"];
  const attemptCount = artifactDelivery["attemptCount"];
  const maxAttempts = artifactDelivery["maxAttempts"];
  const bodySha256 = artifactDelivery["bodySha256"];
  const adapterCatalogSha256 = artifactDelivery["adapterCatalogSha256"];
  return {
    ...(typeof idempotencyFingerprint === "string"
      ? { idempotencyFingerprint }
      : {}),
    ...(isNonNegativeInteger(attemptCount) ? { attemptCount } : {}),
    ...(isNonNegativeInteger(maxAttempts) ? { maxAttempts } : {}),
    ...(typeof bodySha256 === "string" && SHA256_PATTERN.test(bodySha256)
      ? { bodySha256 }
      : {}),
    ...(typeof adapterCatalogSha256 === "string" &&
    SHA256_PATTERN.test(adapterCatalogSha256)
      ? { adapterCatalogSha256 }
      : {}),
  };
}

function summarizeDeliveries(
  deliveries: unknown[],
  currentAdapterCatalogSha256: string | undefined,
  addDiagnostic: (message: string) => void,
): {
  qualifiedCount: number;
  evidenceMissingCount: number;
  adapterCatalogDriftCount: number;
} {
  const summary = {
    qualifiedCount: 0,
    evidenceMissingCount: 0,
    adapterCatalogDriftCount: 0,
  };
  deliveries.forEach((delivery, index) => {
    if (!isRecord(delivery)) {
      addDiagnostic(`Delivery ${index} must be an object.`);
      return;
    }
    reportUnknownKeys(
      delivery,
      DELIVERY_KEYS,
      `Delivery ${index}`,
      addDiagnostic,
    );
    for (const key of [
      "deliveryId",
      "threadId",
      "idempotencyFingerprint",
      "triggerId",
      "error",
      "createdAt",
    ]) {
      if (typeof delivery[key] !== "string") {
        addDiagnostic(`Delivery ${index} ${key} must be a string.`);
      }
    }
    for (const key of ["attemptCount", "maxAttempts", "retryBaseMs"]) {
      if (!isNonNegativeInteger(delivery[key])) {
        addDiagnostic(
          `Delivery ${index} ${key} must be a non-negative integer.`,
        );
      }
    }
    if (
      delivery["retryDisposition"] !== "manual_retry_available" &&
      delivery["retryDisposition"] !== "retry_exhausted"
    ) {
      addDiagnostic(`Delivery ${index} retryDisposition is invalid.`);
    }
    const messageSha256 = readOptionalSha256(
      delivery,
      "messageSha256",
      addDiagnostic,
    );
    if (!messageSha256) {
      addDiagnostic(`Delivery ${index} messageSha256 is required.`);
    }
    const bodySha256 = readOptionalSha256(
      delivery,
      "bodySha256",
      addDiagnostic,
    );
    const adapterCatalogSha256 = readOptionalSha256(
      delivery,
      "adapterCatalogSha256",
      addDiagnostic,
    );
    for (const key of ["runId", "lastAttemptAt", "finishedAt"]) {
      if (delivery[key] !== undefined && typeof delivery[key] !== "string") {
        addDiagnostic(`Delivery ${index} ${key} must be a string.`);
      }
    }
    const status = readQualificationStatus(delivery, index, addDiagnostic);
    if (status === "qualified") summary.qualifiedCount += 1;
    if (status === "evidence_missing") summary.evidenceMissingCount += 1;
    if (status === "adapter_catalog_drift")
      summary.adapterCatalogDriftCount += 1;

    if (currentAdapterCatalogSha256) {
      const expectedStatus =
        !bodySha256 || !adapterCatalogSha256
          ? "evidence_missing"
          : adapterCatalogSha256 === currentAdapterCatalogSha256
            ? "qualified"
            : "adapter_catalog_drift";
      if (status !== expectedStatus) {
        addDiagnostic(
          `Delivery ${index} qualificationStatus does not match stored evidence.`,
        );
      }
    } else if (status !== undefined) {
      addDiagnostic(
        `Delivery ${index} qualificationStatus requires currentAdapterCatalogSha256.`,
      );
    }
  });
  return summary;
}

function readQualificationStatus(
  delivery: Record<string, unknown>,
  index: number,
  addDiagnostic: (message: string) => void,
): InboundDeliveryQualificationStatus | undefined {
  const value = delivery["qualificationStatus"];
  if (value === undefined) return undefined;
  if (
    value === "qualified" ||
    value === "evidence_missing" ||
    value === "adapter_catalog_drift"
  ) {
    return value;
  }
  addDiagnostic(`Delivery ${index} qualificationStatus is invalid.`);
  return undefined;
}

function readOptionalSha256(
  record: Record<string, unknown>,
  key: string,
  addDiagnostic: (message: string) => void,
): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    addDiagnostic(`${key} must be a SHA-256 hex digest.`);
    return undefined;
  }
  return value;
}

function readSha256(value: unknown): string | undefined {
  return typeof value === "string" && SHA256_PATTERN.test(value)
    ? value
    : undefined;
}

function readOptionalNonNegativeInteger(
  record: Record<string, unknown>,
  key: string,
  addDiagnostic: (message: string) => void,
): number | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (!isNonNegativeInteger(value)) {
    addDiagnostic(`${key} must be a non-negative integer.`);
    return undefined;
  }
  return value;
}

function reportUnknownKeys(
  record: Record<string, unknown>,
  supportedKeys: ReadonlySet<string>,
  label: string,
  addDiagnostic: (message: string) => void,
): void {
  const unknownKeys = Object.keys(record).filter(
    (key) => !supportedKeys.has(key),
  );
  if (unknownKeys.length > 0) {
    addDiagnostic(
      `${label} has unsupported field(s): ${unknownKeys.join(", ")}.`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isIsoString(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
