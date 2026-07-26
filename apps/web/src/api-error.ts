export class NapierApiError extends Error {
  readonly serverMessage: string;
  readonly status: number;
  readonly code?: string;
  readonly contentSha256?: string;
  readonly messageSha256?: string;
  readonly payload?: unknown;

  constructor(
    serverMessage: string,
    options: {
      status: number;
      code?: string;
      contentSha256?: string;
      messageSha256?: string;
      payload?: unknown;
    },
  ) {
    super(options.code ? `${serverMessage} [${options.code}]` : serverMessage);
    this.name = "NapierApiError";
    this.serverMessage = serverMessage;
    this.status = options.status;
    if (options.code) this.code = options.code;
    if (options.contentSha256) this.contentSha256 = options.contentSha256;
    if (options.messageSha256) this.messageSha256 = options.messageSha256;
    if (options.payload !== undefined) this.payload = options.payload;
  }
}

export class NapierContentHashError extends Error {
  readonly status: number;
  readonly expectedSha256: string;
  readonly actualSha256: string;
  readonly evidence: "response" | "error_message";

  constructor(
    path: string,
    options: {
      status: number;
      expectedSha256: string;
      actualSha256: string;
      evidence?: "response" | "error_message";
    },
  ) {
    const evidence = options.evidence ?? "response";
    super(
      `${evidence === "error_message" ? "Error message" : "Response"} hash mismatch for ${path}`,
    );
    this.name = "NapierContentHashError";
    this.status = options.status;
    this.expectedSha256 = options.expectedSha256;
    this.actualSha256 = options.actualSha256;
    this.evidence = evidence;
  }
}

export class NapierContentHashModeError extends Error {
  readonly status: number;
  readonly mode: string;

  constructor(
    path: string,
    options: {
      status: number;
      mode: string;
    },
  ) {
    super(`Unsupported content hash mode for ${path}: ${options.mode}`);
    this.name = "NapierContentHashModeError";
    this.status = options.status;
    this.mode = options.mode;
  }
}

export class NapierContentHashMissingError extends Error {
  readonly status: number;

  constructor(path: string, options: { status: number }) {
    super(`Missing content hash for ${path}`);
    this.name = "NapierContentHashMissingError";
    this.status = options.status;
  }
}

export class NapierJsonParseError extends Error {
  readonly status: number;
  readonly contentSha256?: string;

  constructor(
    path: string,
    options: {
      status: number;
      contentSha256?: string;
    },
  ) {
    super(`Invalid JSON response for ${path}`);
    this.name = "NapierJsonParseError";
    this.status = options.status;
    if (options.contentSha256) this.contentSha256 = options.contentSha256;
  }
}

export class NapierStreamFrameParseError extends Error {
  readonly frameSha256: string;
  readonly lineCount: number;

  constructor(
    path: string,
    options: {
      frameSha256: string;
      lineCount: number;
    },
  ) {
    super(`Invalid stream frame for ${path}`);
    this.name = "NapierStreamFrameParseError";
    this.frameSha256 = options.frameSha256;
    this.lineCount = options.lineCount;
  }
}

export type NapierStreamFrameContractReason =
  | "not_object"
  | "missing_type"
  | "unsupported_type"
  | "invalid_event"
  | "invalid_snapshot"
  | "invalid_error_message"
  | "invalid_done";

export class NapierStreamFrameContractError extends Error {
  readonly frameSha256: string;
  readonly lineCount: number;
  readonly reason: NapierStreamFrameContractReason;

  constructor(
    path: string,
    options: {
      frameSha256: string;
      lineCount: number;
      reason: NapierStreamFrameContractReason;
    },
  ) {
    super(`Invalid stream frame contract for ${path}`);
    this.name = "NapierStreamFrameContractError";
    this.frameSha256 = options.frameSha256;
    this.lineCount = options.lineCount;
    this.reason = options.reason;
  }
}

export class NapierStreamResponseContractError extends Error {
  readonly status: number;
  readonly header: string;
  readonly expected: string;
  readonly actual?: string;

  constructor(
    path: string,
    options: {
      status: number;
      header: string;
      expected: string;
      actual?: string;
    },
  ) {
    super(`Invalid stream response contract for ${path}: ${options.header}`);
    this.name = "NapierStreamResponseContractError";
    this.status = options.status;
    this.header = options.header;
    this.expected = options.expected;
    if (options.actual !== undefined) this.actual = options.actual;
  }
}

export class NapierStreamTerminationError extends Error {
  readonly frameCount: number;
  readonly lastFrameType?: string;

  constructor(
    path: string,
    options: {
      frameCount: number;
      lastFrameType?: string;
    },
  ) {
    super(`Stream ended without terminal frame for ${path}`);
    this.name = "NapierStreamTerminationError";
    this.frameCount = options.frameCount;
    if (options.lastFrameType !== undefined) {
      this.lastFrameType = options.lastFrameType;
    }
  }
}

export class NapierStreamFrameOrderError extends Error {
  readonly frameCount: number;
  readonly terminalFrameType: string;
  readonly nextFrameType: string;

  constructor(
    path: string,
    options: {
      frameCount: number;
      terminalFrameType: string;
      nextFrameType: string;
    },
  ) {
    super(`Stream emitted a frame after terminal frame for ${path}`);
    this.name = "NapierStreamFrameOrderError";
    this.frameCount = options.frameCount;
    this.terminalFrameType = options.terminalFrameType;
    this.nextFrameType = options.nextFrameType;
  }
}

export class NapierStreamSnapshotMissingError extends Error {
  readonly frameCount: number;
  readonly runId: string;
  readonly status: string;
  readonly frameSha256: string;

  constructor(
    path: string,
    options: {
      frameCount: number;
      runId: string;
      status: string;
      frameSha256: string;
    },
  ) {
    super(`Stream completed without final snapshot for ${path}`);
    this.name = "NapierStreamSnapshotMissingError";
    this.frameCount = options.frameCount;
    this.runId = options.runId;
    this.status = options.status;
    this.frameSha256 = options.frameSha256;
  }
}

export class NapierStreamDoneSnapshotHashError extends Error {
  readonly expectedSha256: string;
  readonly actualSha256: string;
  readonly frameSha256: string;

  constructor(
    path: string,
    options: {
      expectedSha256: string;
      actualSha256: string;
      frameSha256: string;
    },
  ) {
    super(`Stream done snapshot hash mismatch for ${path}`);
    this.name = "NapierStreamDoneSnapshotHashError";
    this.expectedSha256 = options.expectedSha256;
    this.actualSha256 = options.actualSha256;
    this.frameSha256 = options.frameSha256;
  }
}

export class NapierStreamDoneEventCountError extends Error {
  readonly expectedEventCount: number;
  readonly actualEventCount: number;
  readonly snapshotSha256: string;
  readonly frameSha256: string;

  constructor(
    path: string,
    options: {
      expectedEventCount: number;
      actualEventCount: number;
      snapshotSha256: string;
      frameSha256: string;
    },
  ) {
    super(`Stream done event count mismatch for ${path}`);
    this.name = "NapierStreamDoneEventCountError";
    this.expectedEventCount = options.expectedEventCount;
    this.actualEventCount = options.actualEventCount;
    this.snapshotSha256 = options.snapshotSha256;
    this.frameSha256 = options.frameSha256;
  }
}

export class NapierStreamDoneEventStreamHashError extends Error {
  readonly expectedSha256: string;
  readonly actualSha256: string;
  readonly frameSha256: string;

  constructor(
    path: string,
    options: {
      expectedSha256: string;
      actualSha256: string;
      frameSha256: string;
    },
  ) {
    super(`Stream done event-stream hash mismatch for ${path}`);
    this.name = "NapierStreamDoneEventStreamHashError";
    this.expectedSha256 = options.expectedSha256;
    this.actualSha256 = options.actualSha256;
    this.frameSha256 = options.frameSha256;
  }
}

export type NapierStreamSnapshotRunReason = "run_missing" | "status_mismatch";

export class NapierStreamSnapshotRunError extends Error {
  readonly reason: NapierStreamSnapshotRunReason;
  readonly runId: string;
  readonly doneStatus: string;
  readonly snapshotStatus?: string;
  readonly snapshotSha256: string;
  readonly frameSha256: string;

  constructor(
    path: string,
    options: {
      reason: NapierStreamSnapshotRunReason;
      runId: string;
      doneStatus: string;
      snapshotStatus?: string;
      snapshotSha256: string;
      frameSha256: string;
    },
  ) {
    super(`Stream final snapshot does not match done frame for ${path}`);
    this.name = "NapierStreamSnapshotRunError";
    this.reason = options.reason;
    this.runId = options.runId;
    this.doneStatus = options.doneStatus;
    if (options.snapshotStatus !== undefined) {
      this.snapshotStatus = options.snapshotStatus;
    }
    this.snapshotSha256 = options.snapshotSha256;
    this.frameSha256 = options.frameSha256;
  }
}

export type NapierStreamSnapshotEventReason =
  | "event_missing"
  | "event_mismatch";

export class NapierStreamSnapshotEventError extends Error {
  readonly reason: NapierStreamSnapshotEventReason;
  readonly seq: number;
  readonly expectedSha256: string;
  readonly actualSha256?: string;
  readonly snapshotSha256: string;
  readonly frameSha256: string;

  constructor(
    path: string,
    options: {
      reason: NapierStreamSnapshotEventReason;
      seq: number;
      expectedSha256: string;
      actualSha256?: string;
      snapshotSha256: string;
      frameSha256: string;
    },
  ) {
    super(`Stream final snapshot does not match streamed event for ${path}`);
    this.name = "NapierStreamSnapshotEventError";
    this.reason = options.reason;
    this.seq = options.seq;
    this.expectedSha256 = options.expectedSha256;
    if (options.actualSha256 !== undefined) {
      this.actualSha256 = options.actualSha256;
    }
    this.snapshotSha256 = options.snapshotSha256;
    this.frameSha256 = options.frameSha256;
  }
}

export class NapierStreamFrameEventTypeError extends Error {
  readonly eventType: string;
  readonly frameType: string;
  readonly frameSha256: string;

  constructor(
    path: string,
    options: {
      eventType: string;
      frameType: string;
      frameSha256: string;
    },
  ) {
    super(`Stream event type mismatch for ${path}`);
    this.name = "NapierStreamFrameEventTypeError";
    this.eventType = options.eventType;
    this.frameType = options.frameType;
    this.frameSha256 = options.frameSha256;
  }
}

export class NapierStreamFrameIdError extends Error {
  readonly frameType: string;
  readonly expectedId: string;
  readonly actualId?: string;
  readonly frameSha256: string;

  constructor(
    path: string,
    options: {
      frameType: string;
      expectedId: string;
      actualId?: string;
      frameSha256: string;
    },
  ) {
    super(`Stream frame id mismatch for ${path}`);
    this.name = "NapierStreamFrameIdError";
    this.frameType = options.frameType;
    this.expectedId = options.expectedId;
    if (options.actualId !== undefined) this.actualId = options.actualId;
    this.frameSha256 = options.frameSha256;
  }
}

export class NapierStreamThreadIdentityError extends Error {
  readonly frameType: string;
  readonly expectedThreadId: string;
  readonly actualThreadId: string;
  readonly frameSha256: string;

  constructor(
    path: string,
    options: {
      frameType: string;
      expectedThreadId: string;
      actualThreadId: string;
      frameSha256: string;
    },
  ) {
    super(`Stream thread identity mismatch for ${path}`);
    this.name = "NapierStreamThreadIdentityError";
    this.frameType = options.frameType;
    this.expectedThreadId = options.expectedThreadId;
    this.actualThreadId = options.actualThreadId;
    this.frameSha256 = options.frameSha256;
  }
}

export class NapierStreamRunIdentityError extends Error {
  readonly frameType: string;
  readonly expectedRunId: string;
  readonly actualRunId: string;
  readonly frameSha256: string;

  constructor(
    path: string,
    options: {
      frameType: string;
      expectedRunId: string;
      actualRunId: string;
      frameSha256: string;
    },
  ) {
    super(`Stream run identity mismatch for ${path}`);
    this.name = "NapierStreamRunIdentityError";
    this.frameType = options.frameType;
    this.expectedRunId = options.expectedRunId;
    this.actualRunId = options.actualRunId;
    this.frameSha256 = options.frameSha256;
  }
}

export class NapierStreamEventHashError extends Error {
  readonly expectedSha256: string;
  readonly actualSha256: string;
  readonly frameSha256: string;

  constructor(
    path: string,
    options: {
      expectedSha256: string;
      actualSha256: string;
      frameSha256: string;
    },
  ) {
    super(`Stream event hash mismatch for ${path}`);
    this.name = "NapierStreamEventHashError";
    this.expectedSha256 = options.expectedSha256;
    this.actualSha256 = options.actualSha256;
    this.frameSha256 = options.frameSha256;
  }
}

export class NapierStreamSnapshotHashError extends Error {
  readonly expectedSha256: string;
  readonly actualSha256: string;
  readonly frameSha256: string;

  constructor(
    path: string,
    options: {
      expectedSha256: string;
      actualSha256: string;
      frameSha256: string;
    },
  ) {
    super(`Stream snapshot hash mismatch for ${path}`);
    this.name = "NapierStreamSnapshotHashError";
    this.expectedSha256 = options.expectedSha256;
    this.actualSha256 = options.actualSha256;
    this.frameSha256 = options.frameSha256;
  }
}

export class NapierStreamEventSequenceError extends Error {
  readonly previousSeq: number;
  readonly currentSeq: number;
  readonly frameSha256: string;

  constructor(
    path: string,
    options: {
      previousSeq: number;
      currentSeq: number;
      frameSha256: string;
    },
  ) {
    super(`Stream event sequence is not increasing for ${path}`);
    this.name = "NapierStreamEventSequenceError";
    this.previousSeq = options.previousSeq;
    this.currentSeq = options.currentSeq;
    this.frameSha256 = options.frameSha256;
  }
}

const SHA256 = /^[a-f0-9]{64}$/;

export async function throwNapierApiError(
  response: Response,
  fallbackPrefix = "Request failed",
  path = "response",
): Promise<never> {
  throw await createNapierApiError(response, fallbackPrefix, path);
}

export async function verifyNapierContentHash(
  path: string,
  response: Response,
  text: string,
  payload?: unknown,
): Promise<string | undefined> {
  const expectedSha256 = headerValue(response, "x-napier-content-sha256");
  if (!expectedSha256) return undefined;
  const mode = contentSha256Mode(response, path);
  const actualSha256 = await sha256Text(text);
  if (mode !== "stable" && actualSha256 === expectedSha256) {
    return expectedSha256;
  }
  if (
    mode !== "body" &&
    (await stablePayloadDigestMatches(payload, expectedSha256))
  ) {
    return expectedSha256;
  }
  throw new NapierContentHashError(path, {
    status: response.status,
    expectedSha256,
    actualSha256,
  });
}

export async function verifyNapierBodyContentHash(
  path: string,
  response: Response,
  text: string,
): Promise<string | undefined> {
  const expectedSha256 = headerValue(response, "x-napier-content-sha256");
  if (!expectedSha256) return undefined;
  const mode = contentSha256Mode(response, path);
  const actualSha256 = await sha256Text(text);
  if (actualSha256 === expectedSha256 && mode !== "stable") {
    return expectedSha256;
  }
  if (mode === "body") {
    throw new NapierContentHashError(path, {
      status: response.status,
      expectedSha256,
      actualSha256,
    });
  }
  return undefined;
}

export function parseVerifiedJson<T>(
  path: string,
  response: Response,
  text: string,
  contentSha256?: string,
): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new NapierJsonParseError(path, {
      status: response.status,
      ...(contentSha256 ? { contentSha256 } : {}),
    });
  }
}

function contentSha256Mode(
  response: Response,
  path: string,
): "body" | "stable" | undefined {
  const mode = headerValue(response, "x-napier-content-sha256-mode");
  if (!mode) return undefined;
  if (mode === "body" || mode === "stable") return mode;
  throw new NapierContentHashModeError(path, {
    status: response.status,
    mode,
  });
}

export function formatApiErrorMessage(error: unknown): string {
  if (error instanceof NapierApiError) {
    const details = [
      `HTTP ${error.status}`,
      ...(error.code ? [error.code] : []),
      ...(error.contentSha256
        ? [`body ${error.contentSha256.slice(0, 12)}`]
        : []),
      ...(error.messageSha256
        ? [`message ${error.messageSha256.slice(0, 12)}`]
        : []),
    ];
    return `${error.serverMessage} (${details.join(" · ")})`;
  }
  if (error instanceof NapierContentHashError) {
    return `${error.message} (HTTP ${error.status} · expected ${error.expectedSha256.slice(0, 12)} · actual ${error.actualSha256.slice(0, 12)})`;
  }
  if (error instanceof NapierContentHashModeError) {
    return `${error.message} (HTTP ${error.status})`;
  }
  if (error instanceof NapierContentHashMissingError) {
    return `${error.message} (HTTP ${error.status})`;
  }
  if (error instanceof NapierJsonParseError) {
    return `${error.message} (HTTP ${error.status}${error.contentSha256 ? ` · body ${error.contentSha256.slice(0, 12)}` : ""})`;
  }
  if (error instanceof NapierStreamFrameParseError) {
    return `${error.message} (frame ${error.frameSha256.slice(0, 12)} · ${error.lineCount} line${error.lineCount === 1 ? "" : "s"})`;
  }
  if (error instanceof NapierStreamFrameContractError) {
    return `${error.message} (${error.reason} · frame ${error.frameSha256.slice(0, 12)} · ${error.lineCount} line${error.lineCount === 1 ? "" : "s"})`;
  }
  if (error instanceof NapierStreamResponseContractError) {
    return `${error.message} (HTTP ${error.status} · expected ${error.expected}${error.actual === undefined ? "" : ` · actual ${error.actual}`})`;
  }
  if (error instanceof NapierStreamTerminationError) {
    return `${error.message} (${error.frameCount} frame${error.frameCount === 1 ? "" : "s"} · last ${error.lastFrameType ?? "none"})`;
  }
  if (error instanceof NapierStreamFrameOrderError) {
    return `${error.message} (${error.frameCount} frame${error.frameCount === 1 ? "" : "s"} · terminal ${error.terminalFrameType} · next ${error.nextFrameType})`;
  }
  if (error instanceof NapierStreamSnapshotMissingError) {
    return `${error.message} (${error.frameCount} frame${error.frameCount === 1 ? "" : "s"} · run ${error.runId} · status ${error.status} · body ${error.frameSha256.slice(0, 12)})`;
  }
  if (error instanceof NapierStreamDoneSnapshotHashError) {
    return `${error.message} (expected ${error.expectedSha256.slice(0, 12)} · actual ${error.actualSha256.slice(0, 12)} · body ${error.frameSha256.slice(0, 12)})`;
  }
  if (error instanceof NapierStreamDoneEventCountError) {
    return `${error.message} (expected ${error.expectedEventCount} · actual ${error.actualEventCount} · snapshot ${error.snapshotSha256.slice(0, 12)} · body ${error.frameSha256.slice(0, 12)})`;
  }
  if (error instanceof NapierStreamDoneEventStreamHashError) {
    return `${error.message} (expected ${error.expectedSha256.slice(0, 12)} · actual ${error.actualSha256.slice(0, 12)} · body ${error.frameSha256.slice(0, 12)})`;
  }
  if (error instanceof NapierStreamSnapshotRunError) {
    return `${error.message} (${error.reason} · run ${error.runId} · done ${error.doneStatus} · snapshot ${error.snapshotStatus ?? "missing"} · snapshot ${error.snapshotSha256.slice(0, 12)} · body ${error.frameSha256.slice(0, 12)})`;
  }
  if (error instanceof NapierStreamSnapshotEventError) {
    return `${error.message} (${error.reason} · seq ${error.seq} · expected ${error.expectedSha256.slice(0, 12)} · actual ${error.actualSha256?.slice(0, 12) ?? "missing"} · snapshot ${error.snapshotSha256.slice(0, 12)} · body ${error.frameSha256.slice(0, 12)})`;
  }
  if (error instanceof NapierStreamFrameEventTypeError) {
    return `${error.message} (event ${error.eventType} · frame ${error.frameType} · body ${error.frameSha256.slice(0, 12)})`;
  }
  if (error instanceof NapierStreamFrameIdError) {
    return `${error.message} (frame ${error.frameType} · expected ${error.expectedId} · actual ${error.actualId ?? "absent"} · body ${error.frameSha256.slice(0, 12)})`;
  }
  if (error instanceof NapierStreamThreadIdentityError) {
    return `${error.message} (frame ${error.frameType} · expected ${error.expectedThreadId} · actual ${error.actualThreadId} · body ${error.frameSha256.slice(0, 12)})`;
  }
  if (error instanceof NapierStreamRunIdentityError) {
    return `${error.message} (frame ${error.frameType} · expected ${error.expectedRunId} · actual ${error.actualRunId} · body ${error.frameSha256.slice(0, 12)})`;
  }
  if (error instanceof NapierStreamEventHashError) {
    return `${error.message} (expected ${error.expectedSha256.slice(0, 12)} · actual ${error.actualSha256.slice(0, 12)} · body ${error.frameSha256.slice(0, 12)})`;
  }
  if (error instanceof NapierStreamSnapshotHashError) {
    return `${error.message} (expected ${error.expectedSha256.slice(0, 12)} · actual ${error.actualSha256.slice(0, 12)} · body ${error.frameSha256.slice(0, 12)})`;
  }
  if (error instanceof NapierStreamEventSequenceError) {
    return `${error.message} (previous ${error.previousSeq} · current ${error.currentSeq} · body ${error.frameSha256.slice(0, 12)})`;
  }
  return error instanceof Error ? error.message : String(error);
}

async function createNapierApiError(
  response: Response,
  fallbackPrefix: string,
  path: string,
): Promise<NapierApiError> {
  const text = await response.text().catch(() => "");
  requireNapierContentHash(path, response);
  const verifiedBodySha256 = await verifyNapierBodyContentHash(
    path,
    response,
    text,
  );
  const payload = verifiedBodySha256
    ? parseVerifiedJson<unknown>(path, response, text, verifiedBodySha256)
    : parseJsonPayload(text);
  const contentSha256 =
    verifiedBodySha256 ??
    (await verifyNapierContentHash(path, response, text, payload));
  const serverMessage = hasStringError(payload)
    ? payload.error
    : `${fallbackPrefix} with ${response.status}`;
  const code = headerValue(response, "x-napier-error-code");
  const messageSha256 = headerValue(response, "x-napier-error-message-sha256");
  if (messageSha256) {
    const actualMessageSha256 = await sha256Text(serverMessage);
    if (actualMessageSha256 !== messageSha256) {
      throw new NapierContentHashError(path, {
        status: response.status,
        expectedSha256: messageSha256,
        actualSha256: actualMessageSha256,
        evidence: "error_message",
      });
    }
  }
  return new NapierApiError(serverMessage, {
    status: response.status,
    ...(code ? { code } : {}),
    ...(contentSha256 ? { contentSha256 } : {}),
    ...(messageSha256 ? { messageSha256 } : {}),
    ...(payload !== undefined ? { payload } : {}),
  });
}

function parseJsonPayload(text: string): unknown | undefined {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function hasStringError(payload: unknown): payload is { error: string } {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string"
  );
}

export function requireNapierContentHash(
  path: string,
  response: Response,
): void {
  if (!headerValue(response, "x-napier-content-sha256")) {
    throw new NapierContentHashMissingError(path, { status: response.status });
  }
}

async function stablePayloadDigestMatches(
  payload: unknown,
  expectedSha256: string,
): Promise<boolean> {
  if (!isRecord(payload)) return false;
  for (const { digestKey, contents } of stableDigestCandidateContents(
    payload,
  )) {
    if (payload[digestKey] !== expectedSha256) continue;
    for (const content of contents) {
      if ((await sha256Text(canonicalJson(content))) === expectedSha256) {
        return true;
      }
    }
  }
  return false;
}

function stableDigestCandidateContents(payload: Record<string, unknown>): {
  digestKey: "contentSha256" | "reviewSha256";
  contents: unknown[];
}[] {
  const candidates: {
    digestKey: "contentSha256" | "reviewSha256";
    contents: unknown[];
  }[] = [];
  if (isSha256(payload["contentSha256"])) {
    candidates.push({
      digestKey: "contentSha256",
      contents: uniqueCanonicalContents([
        omitTopLevel(payload, ["contentSha256"]),
        omitTopLevel(payload, ["contentSha256", "generatedAt"]),
        omitTopLevel(payload, ["contentSha256", "exportedAt"]),
        omitTopLevel(payload, ["contentSha256", "generatedAt", "exportedAt"]),
        omitTopLevel(payload, ["contentSha256", "id"]),
        omitTopLevel(payload, [
          "contentSha256",
          "id",
          "startedAt",
          "finishedAt",
        ]),
        ...specialContentDigestCandidateContents(payload),
      ]),
    });
  }
  if (isSha256(payload["reviewSha256"])) {
    candidates.push({
      digestKey: "reviewSha256",
      contents: uniqueCanonicalContents([
        omitTopLevel(payload, ["reviewSha256"]),
        omitTopLevel(payload, ["reviewSha256", "generatedAt"]),
      ]),
    });
  }
  return candidates;
}

function specialContentDigestCandidateContents(
  payload: Record<string, unknown>,
): unknown[] {
  switch (payload["kind"]) {
    case "napier.extension-package-deployment-preview":
      return [extensionPackageDeploymentPreviewDigestContent(payload)];
    case "napier.extension-package-rollout-preview":
      return [extensionPackageRolloutPreviewDigestContent(payload)];
    case "napier.evaluation-casebook":
      return [evaluationCasebookArtifactDigestContent(payload)];
    default:
      return [];
  }
}

function extensionPackageDeploymentPreviewDigestContent(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const content = omitTopLevel(payload, ["contentSha256", "generatedAt"]);
  if (!Array.isArray(content["items"])) return content;
  return {
    ...content,
    items: content["items"].map((item) => {
      if (!isRecord(item)) return item;
      const { updatePreview, ...itemContent } = item;
      const updatePreviewSha256 = isRecord(updatePreview)
        ? updatePreview["contentSha256"]
        : undefined;
      return {
        ...itemContent,
        ...(isSha256(updatePreviewSha256) ? { updatePreviewSha256 } : {}),
      };
    }),
  };
}

function extensionPackageRolloutPreviewDigestContent(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const content = omitTopLevel(payload, ["contentSha256", "generatedAt"]);
  const verification = isRecord(content["verification"])
    ? content["verification"]
    : {};
  const deploymentPreview = isRecord(content["deploymentPreview"])
    ? content["deploymentPreview"]
    : undefined;
  return {
    ...content,
    verification: {
      status: verification["status"],
      packageCount: verification["packageCount"],
      lockfileSha256: verification["lockfileSha256"] ?? "",
      packageEnvelopeSha256es: verification["packageEnvelopeSha256es"],
    },
    deploymentPreviewSha256: deploymentPreview?.["contentSha256"],
    deploymentPreview: undefined,
  };
}

function evaluationCasebookArtifactDigestContent(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const content = omitTopLevel(payload, ["contentSha256", "generatedAt"]);
  if (!isRecord(content["calibration"])) return content;
  return {
    ...content,
    calibration: omitTopLevel(content["calibration"], ["generatedAt"]),
  };
}

function omitTopLevel(
  payload: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const keySet = new Set(keys);
  return Object.fromEntries(
    Object.entries(payload).filter(([key]) => !keySet.has(key)),
  );
}

function uniqueCanonicalContents(contents: unknown[]): unknown[] {
  const seen = new Set<string>();
  const unique = [];
  for (const content of contents) {
    const key = canonicalJson(content);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(content);
    }
  }
  return unique;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
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
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function headerValue(response: Response, name: string): string | undefined {
  return response.headers.get(name) ?? undefined;
}

export async function sha256Text(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
