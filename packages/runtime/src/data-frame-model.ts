export const MAX_DATA_FRAME_SOURCE_ROWS = 10_000;
export const MAX_DATA_FRAME_RESULT_ROWS = 1_000;
export const MAX_DATA_FRAME_COLUMNS = 80;
export const MAX_DATA_FRAME_OPERATIONS = 12;
export const MAX_DATA_FRAME_CELL_BYTES = 4_096;
export const MAX_DATA_FRAME_COLUMN_CHARS = 80;
export const MAX_DATA_FRAME_GROUP_COLUMNS = 4;
export const MAX_DATA_FRAME_AGGREGATIONS = 8;
export const MAX_DATA_FRAME_SORT_COLUMNS = 4;

export type DataFrameCell = string | number | boolean | null;
export type DataFrameCastType = "string" | "number" | "boolean";
export type DataFrameFilterOperator =
  | "eq"
  | "ne"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "is_null"
  | "not_null";
export type DataFrameAggregationOperation =
  | "count"
  | "sum"
  | "mean"
  | "min"
  | "max";

export interface DataFrameCastOperation {
  type: "cast";
  column: string;
  dataType: DataFrameCastType;
  outputColumn?: string;
}

export interface DataFrameFilterOperation {
  type: "filter";
  column: string;
  operator: DataFrameFilterOperator;
  value?: DataFrameCell;
}

export interface DataFrameSelectOperation {
  type: "select";
  columns: string[];
}

export interface DataFrameSortOperation {
  type: "sort";
  columns: Array<{
    column: string;
    direction: "asc" | "desc";
  }>;
}

export interface DataFrameGroupOperation {
  type: "group";
  by: string[];
  aggregations: Array<{
    operation: DataFrameAggregationOperation;
    column?: string;
    as: string;
  }>;
}

export interface DataFrameLimitOperation {
  type: "limit";
  count: number;
}

export type DataFrameOperation =
  | DataFrameCastOperation
  | DataFrameFilterOperation
  | DataFrameSelectOperation
  | DataFrameSortOperation
  | DataFrameGroupOperation
  | DataFrameLimitOperation;

export interface DataFrameTable {
  columns: string[];
  rows: DataFrameCell[][];
}
