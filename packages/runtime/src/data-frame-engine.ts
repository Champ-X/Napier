import {
  MAX_DATA_FRAME_OPERATIONS,
  MAX_DATA_FRAME_RESULT_ROWS,
  type DataFrameOperation,
  type DataFrameTable,
} from "./data-frame-model.js";
import {
  executeDataFrameOperation,
  normalizeDataFrameSource,
} from "./data-frame-operations.js";
import { canonicalJson, sha256 } from "./ed25519.js";

export * from "./data-frame-model.js";

export const DATA_FRAME_ENGINE_SHA256 = sha256(
  canonicalJson({
    schemaVersion: 1,
    operations: ["cast", "filter", "select", "sort", "group", "limit"],
    castPolicy: "explicit-scalar-only",
    filterPolicy: "typed-no-coercion",
    sortPolicy: "stable-null-last-homogeneous",
    groupPolicy: "first-seen-count-sum-mean-min-max",
    numericPolicy: "finite-only",
    resultPolicy: "complete-bounded-table",
  }),
);

export function executeDataFrameOperations(
  sourceColumns: string[],
  sourceRows: unknown[][],
  operations: DataFrameOperation[],
): DataFrameTable {
  if (
    !Array.isArray(operations) ||
    operations.length < 1 ||
    operations.length > MAX_DATA_FRAME_OPERATIONS
  ) {
    throw new Error("DataFrame requires 1-12 operations");
  }
  let table = normalizeDataFrameSource(sourceColumns, sourceRows);
  for (const operation of operations) {
    table = executeDataFrameOperation(table, operation);
  }
  if (table.rows.length > MAX_DATA_FRAME_RESULT_ROWS) {
    throw new Error(
      "DataFrame result exceeds 1,000 rows; add a group or limit operation",
    );
  }
  return table;
}
