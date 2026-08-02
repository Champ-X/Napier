import { canonicalJson } from "./ed25519.js";
import {
  MAX_DATA_FRAME_AGGREGATIONS,
  MAX_DATA_FRAME_CELL_BYTES,
  MAX_DATA_FRAME_COLUMN_CHARS,
  MAX_DATA_FRAME_COLUMNS,
  MAX_DATA_FRAME_GROUP_COLUMNS,
  MAX_DATA_FRAME_RESULT_ROWS,
  MAX_DATA_FRAME_SORT_COLUMNS,
  MAX_DATA_FRAME_SOURCE_ROWS,
  type DataFrameAggregationOperation,
  type DataFrameCastOperation,
  type DataFrameCastType,
  type DataFrameCell,
  type DataFrameFilterOperation,
  type DataFrameFilterOperator,
  type DataFrameGroupOperation,
  type DataFrameLimitOperation,
  type DataFrameOperation,
  type DataFrameSelectOperation,
  type DataFrameSortOperation,
  type DataFrameTable,
} from "./data-frame-model.js";

export function normalizeDataFrameSource(
  columns: string[],
  rows: unknown[][],
): DataFrameTable {
  if (
    !Array.isArray(columns) ||
    columns.length > MAX_DATA_FRAME_COLUMNS ||
    new Set(columns).size !== columns.length ||
    columns.some((column) => normalizeColumn(column) !== column) ||
    !Array.isArray(rows) ||
    rows.length > MAX_DATA_FRAME_SOURCE_ROWS
  ) {
    throw new Error("DataFrame source shape exceeds its limits");
  }
  return {
    columns: [...columns],
    rows: rows.map((row) => {
      if (!Array.isArray(row) || row.length !== columns.length) {
        throw new Error("DataFrame source rows are inconsistent");
      }
      return row.map(normalizeCell);
    }),
  };
}

export function executeDataFrameOperation(
  table: DataFrameTable,
  operation: DataFrameOperation,
): DataFrameTable {
  if (!record(operation)) throw new Error("DataFrame operation is invalid");
  switch (operation.type) {
    case "cast":
      return castColumn(table, operation);
    case "filter":
      return filterRows(table, operation);
    case "select":
      return selectColumns(table, operation);
    case "sort":
      return sortRows(table, operation);
    case "group":
      return groupRows(table, operation);
    case "limit":
      return limitRows(table, operation);
    default:
      throw new Error("DataFrame operation type is unsupported");
  }
}

function castColumn(
  table: DataFrameTable,
  operation: DataFrameCastOperation,
): DataFrameTable {
  exactKeys(operation, ["type", "column", "dataType", "outputColumn"]);
  const sourceIndex = columnIndex(table, operation.column);
  const outputColumn = normalizeColumn(
    operation.outputColumn ?? operation.column,
  );
  const outputIndex = table.columns.indexOf(outputColumn);
  if (outputIndex >= 0 && outputIndex !== sourceIndex) {
    throw new Error("DataFrame output column already exists");
  }
  if (!["string", "number", "boolean"].includes(operation.dataType)) {
    throw new Error("DataFrame cast type is invalid");
  }
  const columns = [...table.columns];
  columns[sourceIndex] = outputColumn;
  return {
    columns,
    rows: table.rows.map((row) =>
      row.map((cell, index) =>
        index === sourceIndex ? castCell(cell, operation.dataType) : cell,
      ),
    ),
  };
}

function filterRows(
  table: DataFrameTable,
  operation: DataFrameFilterOperation,
): DataFrameTable {
  exactKeys(operation, ["type", "column", "operator", "value"]);
  const index = columnIndex(table, operation.column);
  const operators: DataFrameFilterOperator[] = [
    "eq",
    "ne",
    "gt",
    "gte",
    "lt",
    "lte",
    "contains",
    "is_null",
    "not_null",
  ];
  if (!operators.includes(operation.operator)) {
    throw new Error("DataFrame filter operator is invalid");
  }
  const unary =
    operation.operator === "is_null" || operation.operator === "not_null";
  if (unary !== (operation.value === undefined)) {
    throw new Error("DataFrame filter value is invalid");
  }
  const value =
    operation.value === undefined ? undefined : normalizeCell(operation.value);
  return {
    columns: [...table.columns],
    rows: table.rows
      .filter((row) => filterMatches(row[index]!, operation.operator, value))
      .map((row) => [...row]),
  };
}

function selectColumns(
  table: DataFrameTable,
  operation: DataFrameSelectOperation,
): DataFrameTable {
  exactKeys(operation, ["type", "columns"]);
  if (
    !Array.isArray(operation.columns) ||
    operation.columns.length < 1 ||
    operation.columns.length > MAX_DATA_FRAME_COLUMNS ||
    new Set(operation.columns).size !== operation.columns.length
  ) {
    throw new Error("DataFrame select columns are invalid");
  }
  const indexes = operation.columns.map((column) => columnIndex(table, column));
  return {
    columns: operation.columns.map(normalizeColumn),
    rows: table.rows.map((row) => indexes.map((index) => row[index]!)),
  };
}

function sortRows(
  table: DataFrameTable,
  operation: DataFrameSortOperation,
): DataFrameTable {
  exactKeys(operation, ["type", "columns"]);
  if (
    !Array.isArray(operation.columns) ||
    operation.columns.length < 1 ||
    operation.columns.length > MAX_DATA_FRAME_SORT_COLUMNS
  ) {
    throw new Error("DataFrame sort columns are invalid");
  }
  const keys = operation.columns.map((key) => {
    if (
      !record(key) ||
      !exactKeySet(key, ["column", "direction"]) ||
      typeof key.column !== "string" ||
      (key.direction !== "asc" && key.direction !== "desc")
    ) {
      throw new Error("DataFrame sort key is invalid");
    }
    const index = columnIndex(table, String(key.column));
    assertComparableColumn(table.rows, index);
    return { index, direction: key.direction };
  });
  const rows = table.rows.map((row, index) => ({ row: [...row], index }));
  rows.sort((left, right) => {
    for (const key of keys) {
      const leftCell = left.row[key.index]!;
      const rightCell = right.row[key.index]!;
      if (leftCell === null || rightCell === null) {
        if (leftCell !== rightCell) return leftCell === null ? 1 : -1;
        continue;
      }
      const compared = compareCells(leftCell, rightCell);
      if (compared !== 0) return key.direction === "asc" ? compared : -compared;
    }
    return left.index - right.index;
  });
  return { columns: [...table.columns], rows: rows.map(({ row }) => row) };
}

function groupRows(
  table: DataFrameTable,
  operation: DataFrameGroupOperation,
): DataFrameTable {
  exactKeys(operation, ["type", "by", "aggregations"]);
  if (
    !Array.isArray(operation.by) ||
    operation.by.length > MAX_DATA_FRAME_GROUP_COLUMNS ||
    new Set(operation.by).size !== operation.by.length ||
    !Array.isArray(operation.aggregations) ||
    operation.aggregations.length < 1 ||
    operation.aggregations.length > MAX_DATA_FRAME_AGGREGATIONS
  ) {
    throw new Error("DataFrame group specification is invalid");
  }
  const byIndexes = operation.by.map((column) => columnIndex(table, column));
  const aggregations = operation.aggregations.map((aggregation) =>
    normalizeAggregation(table, aggregation),
  );
  const columns = [
    ...operation.by.map(normalizeColumn),
    ...aggregations.map((aggregation) => aggregation.as),
  ];
  if (
    columns.length > MAX_DATA_FRAME_COLUMNS ||
    new Set(columns).size !== columns.length
  ) {
    throw new Error("DataFrame grouped columns are invalid");
  }
  const groups = new Map<
    string,
    { keys: DataFrameCell[]; rows: DataFrameCell[][] }
  >();
  if (byIndexes.length === 0) {
    groups.set(canonicalJson([]), { keys: [], rows: [] });
  }
  for (const row of table.rows) {
    const keys = byIndexes.map((index) => row[index]!);
    const groupKey = canonicalJson(keys);
    const group = groups.get(groupKey) ?? { keys, rows: [] };
    group.rows.push(row);
    groups.set(groupKey, group);
  }
  return {
    columns,
    rows: [...groups.values()].map((group) => [
      ...group.keys,
      ...aggregations.map((aggregation) =>
        aggregateRows(group.rows, aggregation),
      ),
    ]),
  };
}

function limitRows(
  table: DataFrameTable,
  operation: DataFrameLimitOperation,
): DataFrameTable {
  exactKeys(operation, ["type", "count"]);
  if (
    !Number.isSafeInteger(operation.count) ||
    operation.count < 1 ||
    operation.count > MAX_DATA_FRAME_RESULT_ROWS
  ) {
    throw new Error("DataFrame limit must be between 1 and 1,000");
  }
  return {
    columns: [...table.columns],
    rows: table.rows.slice(0, operation.count).map((row) => [...row]),
  };
}

interface NormalizedAggregation {
  operation: DataFrameAggregationOperation;
  index?: number;
  as: string;
}

function normalizeAggregation(
  table: DataFrameTable,
  value: DataFrameGroupOperation["aggregations"][number],
): NormalizedAggregation {
  if (!record(value)) throw new Error("DataFrame aggregation is invalid");
  exactKeys(value, ["operation", "column", "as"]);
  const operations: DataFrameAggregationOperation[] = [
    "count",
    "sum",
    "mean",
    "min",
    "max",
  ];
  if (!operations.includes(value.operation)) {
    throw new Error("DataFrame aggregation operation is invalid");
  }
  const as = normalizeColumn(value.as);
  if (value.operation === "count") {
    if (value.column !== undefined) {
      throw new Error("DataFrame count aggregation does not accept a column");
    }
    return { operation: value.operation, as };
  }
  if (typeof value.column !== "string") {
    throw new Error("DataFrame aggregation column is required");
  }
  return {
    operation: value.operation,
    index: columnIndex(table, value.column),
    as,
  };
}

function aggregateRows(
  rows: DataFrameCell[][],
  aggregation: NormalizedAggregation,
): DataFrameCell {
  if (aggregation.operation === "count") return rows.length;
  const values = rows
    .map((row) => row[aggregation.index!]!)
    .filter((value): value is Exclude<DataFrameCell, null> => value !== null);
  if (values.length === 0) return null;
  if (aggregation.operation === "sum" || aggregation.operation === "mean") {
    if (values.some((value) => typeof value !== "number")) {
      throw new Error(
        `DataFrame ${aggregation.operation} requires a numeric column`,
      );
    }
    const total = (values as number[]).reduce((sum, value) => sum + value, 0);
    const result =
      aggregation.operation === "sum" ? total : total / values.length;
    if (!Number.isFinite(result)) {
      throw new Error("DataFrame aggregation exceeds finite numeric range");
    }
    return result;
  }
  assertComparableValues(values);
  return values.reduce((selected, value) => {
    const compared = compareCells(value, selected);
    return aggregation.operation === "min"
      ? compared < 0
        ? value
        : selected
      : compared > 0
        ? value
        : selected;
  });
}

function filterMatches(
  cell: DataFrameCell,
  operator: DataFrameFilterOperator,
  value: DataFrameCell | undefined,
): boolean {
  if (operator === "is_null") return cell === null;
  if (operator === "not_null") return cell !== null;
  if (operator === "eq" || operator === "ne") {
    const equal = Object.is(cell, value);
    return operator === "eq" ? equal : !equal;
  }
  if (operator === "contains") {
    if (typeof cell !== "string" || typeof value !== "string") {
      throw new Error("DataFrame contains requires string values");
    }
    return cell.includes(value);
  }
  if (cell === null || value === null || value === undefined) return false;
  const compared = compareCells(cell, value);
  if (operator === "gt") return compared > 0;
  if (operator === "gte") return compared >= 0;
  if (operator === "lt") return compared < 0;
  return compared <= 0;
}

function castCell(
  cell: DataFrameCell,
  dataType: DataFrameCastType,
): DataFrameCell {
  if (cell === null) return null;
  if (dataType === "string") return String(cell);
  if (dataType === "number") {
    const parsed =
      typeof cell === "number"
        ? cell
        : typeof cell === "string" &&
            /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/u.test(
              cell,
            )
          ? Number(cell)
          : Number.NaN;
    if (!Number.isFinite(parsed)) {
      throw new Error("DataFrame number cast failed");
    }
    return parsed;
  }
  if (typeof cell === "boolean") return cell;
  if (cell === "true") return true;
  if (cell === "false") return false;
  throw new Error("DataFrame boolean cast failed");
}

function compareCells(left: DataFrameCell, right: DataFrameCell): number {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  if (typeof left !== typeof right || typeof left === "boolean") {
    throw new Error(
      "DataFrame comparison requires homogeneous numbers or strings",
    );
  }
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function assertComparableColumn(rows: DataFrameCell[][], index: number): void {
  assertComparableValues(
    rows.map((row) => row[index]!).filter((value) => value !== null),
  );
}

function assertComparableValues(values: Exclude<DataFrameCell, null>[]): void {
  const types = new Set(values.map((value) => typeof value));
  if (
    types.size > 1 ||
    (types.size === 1 && !types.has("number") && !types.has("string"))
  ) {
    throw new Error(
      "DataFrame comparison requires homogeneous numbers or strings",
    );
  }
}

function normalizeCell(value: unknown): DataFrameCell {
  if (value === undefined || value === null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("DataFrame numeric cells must be finite");
    }
    return value;
  }
  if (typeof value === "boolean") return value;
  if (
    typeof value === "string" &&
    Buffer.byteLength(value, "utf8") <= MAX_DATA_FRAME_CELL_BYTES
  ) {
    return value;
  }
  throw new Error("DataFrame cells must be bounded scalar values");
}

function columnIndex(table: DataFrameTable, value: unknown): number {
  const column = normalizeColumn(value);
  const index = table.columns.indexOf(column);
  if (index < 0) throw new Error("DataFrame column does not exist");
  return index;
}

function normalizeColumn(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("DataFrame column name is invalid");
  }
  const normalized = value.trim();
  if (
    !normalized ||
    normalized !== value ||
    normalized.length > MAX_DATA_FRAME_COLUMN_CHARS ||
    /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(
      normalized,
    )
  ) {
    throw new Error("DataFrame column name is invalid");
  }
  return normalized;
}

function exactKeys(value: object, allowed: readonly string[]): void {
  if (!exactKeySet(value, allowed)) {
    throw new Error("DataFrame operation fields are invalid");
  }
}

function exactKeySet(value: object, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
