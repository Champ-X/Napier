export interface SqliteEventRangeQuery {
  sql: string;
  parameters: Array<string | number>;
}

/** Inputs have already passed the event-query bounds and type normalization. */
export function compileTypedEventRangeQuery(
  threadId: string,
  fromSeq: number,
  toSeq: number,
  types: readonly string[] | undefined,
): SqliteEventRangeQuery | undefined {
  if (!types || types.length !== 2) return undefined;
  // Limit the merge to two branches. Wider merges regressed dense event ranges
  // in the measured workload; those queries retain the ordinary IN plan.
  // Each branch can seek the existing (thread_id, event_type, seq) index.
  // A compound ORDER BY merges those ordered streams; an IN predicate instead
  // permits SQLite to walk the whole thread/seq range to satisfy ordering.
  // Thread-scoped seq is unique, and normalized types are disjoint, so the
  // merge preserves the original inclusive range, order and multiplicity.
  const branch = "SELECT event_json, seq FROM ledger_events " +
    "WHERE thread_id = ? AND seq BETWEEN ? AND ? AND event_type = ?";
  return {
    sql: types.map(() => branch).join(" UNION ALL ") + " ORDER BY seq ASC",
    parameters: types.flatMap((type) => [threadId, fromSeq, toSeq, type]),
  };
}
