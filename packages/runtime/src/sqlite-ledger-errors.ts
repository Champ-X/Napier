export class ConcurrentStoreUpdateError extends Error {
  constructor(expectedRevision: number, actualRevision: number) {
    super(
      `Concurrent store update detected: expected revision ${expectedRevision}, found ${actualRevision}`,
    );
    this.name = "ConcurrentStoreUpdateError";
  }
}

export class ConcurrentRunEventHeadError extends Error {
  constructor(
    readonly runId: string,
    readonly expectedRunHeadSeq: number,
    readonly actualRunHeadSeq: number,
  ) {
    super(
      `Concurrent Run event update detected: ${runId} expected head ${String(expectedRunHeadSeq)}, found ${String(actualRunHeadSeq)}`,
    );
    this.name = "ConcurrentRunEventHeadError";
  }
}

export class ConcurrentRunLeaseUpdateError extends Error {
  constructor(
    readonly runId: string,
    readonly expectedRevision: number,
  ) {
    super(
      `Concurrent Run lease update detected: ${runId} expected revision ${String(expectedRevision)}`,
    );
    this.name = "ConcurrentRunLeaseUpdateError";
  }
}
