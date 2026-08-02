import { describe, expect, it } from "vitest";

import {
  executeDataFrameOperations,
  MAX_DATA_FRAME_RESULT_ROWS,
  MAX_DATA_FRAME_SOURCE_ROWS,
} from "../src/data-frame-engine.js";

describe("bounded DataFrame engine", () => {
  it("casts, filters, groups, sorts, and selects deterministic tabular output", () => {
    const result = executeDataFrameOperations(
      ["region", "status", "amount"],
      [
        ["east", "paid", "10"],
        ["east", "paid", "5"],
        ["west", "paid", "30"],
        ["west", "pending", "100"],
      ],
      [
        { type: "cast", column: "amount", dataType: "number" },
        {
          type: "filter",
          column: "status",
          operator: "eq",
          value: "paid",
        },
        {
          type: "group",
          by: ["region"],
          aggregations: [
            { operation: "sum", column: "amount", as: "Total" },
            { operation: "mean", column: "amount", as: "Average" },
            { operation: "count", as: "Orders" },
          ],
        },
        {
          type: "sort",
          columns: [{ column: "Total", direction: "desc" }],
        },
        {
          type: "select",
          columns: ["region", "Total", "Average", "Orders"],
        },
      ],
    );

    expect(result).toEqual({
      columns: ["region", "Total", "Average", "Orders"],
      rows: [
        ["west", 30, 30, 1],
        ["east", 15, 7.5, 2],
      ],
    });
  });

  it("supports typed filters, stable null-last sorting, and global empty aggregates", () => {
    const filtered = executeDataFrameOperations(
      ["name", "active", "score"],
      [
        ["Ada", true, 98],
        ["Linus", false, null],
        ["Grace", true, 98],
      ],
      [
        {
          type: "filter",
          column: "active",
          operator: "eq",
          value: true,
        },
        {
          type: "sort",
          columns: [
            { column: "score", direction: "desc" },
            { column: "name", direction: "asc" },
          ],
        },
      ],
    );
    const emptyAggregate = executeDataFrameOperations(
      ["value"],
      [],
      [
        {
          type: "group",
          by: [],
          aggregations: [
            { operation: "count", as: "Rows" },
            { operation: "sum", column: "value", as: "Total" },
          ],
        },
      ],
    );

    expect(filtered.rows).toEqual([
      ["Ada", true, 98],
      ["Grace", true, 98],
    ]);
    expect(emptyAggregate).toEqual({
      columns: ["Rows", "Total"],
      rows: [[0, null]],
    });
  });

  it("fails closed on implicit coercion, invalid plans, and row limits", () => {
    expect(() =>
      executeDataFrameOperations(
        ["amount"],
        [["10"], ["2"]],
        [
          {
            type: "sort",
            columns: [{ column: "amount", direction: "asc" }],
          },
        ],
      ),
    ).not.toThrow();
    expect(() =>
      executeDataFrameOperations(
        ["amount"],
        [["10"], [2]],
        [
          {
            type: "sort",
            columns: [{ column: "amount", direction: "asc" }],
          },
        ],
      ),
    ).toThrow("homogeneous");
    expect(() =>
      executeDataFrameOperations(
        ["amount"],
        [["not-numeric"]],
        [{ type: "cast", column: "amount", dataType: "number" }],
      ),
    ).toThrow("number cast failed");
    expect(() =>
      executeDataFrameOperations(
        ["undefined"],
        [["value"]],
        [
          {
            type: "sort",
            columns: [{ direction: "asc" }],
          } as never,
        ],
      ),
    ).toThrow("sort key is invalid");
    expect(() =>
      executeDataFrameOperations(
        ["payload"],
        [[{ nested: true }]],
        [{ type: "limit", count: 1 }],
      ),
    ).toThrow("bounded scalar");
    expect(() =>
      executeDataFrameOperations(
        ["value"],
        Array.from({ length: MAX_DATA_FRAME_SOURCE_ROWS + 1 }, () => [1]),
        [{ type: "limit", count: 1 }],
      ),
    ).toThrow("source shape");
    expect(() =>
      executeDataFrameOperations(
        ["value"],
        Array.from({ length: MAX_DATA_FRAME_RESULT_ROWS + 1 }, () => [1]),
        [
          {
            type: "filter",
            column: "value",
            operator: "eq",
            value: 1,
          },
        ],
      ),
    ).toThrow("result exceeds");
  });
});
