import { describe, expect, it } from "vitest";

import {
  isStructuredDataFormat,
  structuredDataFormatLabel,
} from "../src/structured-data-format-view";

describe("structured data format view", () => {
  it("labels supported structured data formats for Workbench display", () => {
    expect(structuredDataFormatLabel("json")).toBe("JSON");
    expect(structuredDataFormatLabel("jsonl")).toBe("JSONL");
    expect(structuredDataFormatLabel("csv")).toBe("CSV");
    expect(structuredDataFormatLabel("tsv")).toBe("TSV");
    expect(structuredDataFormatLabel("markdown_table")).toBe("Markdown table");
  });

  it("keeps unknown format tokens unchanged", () => {
    expect(isStructuredDataFormat("markdown_table")).toBe(true);
    expect(isStructuredDataFormat("parquet")).toBe(false);
    expect(structuredDataFormatLabel("parquet")).toBe("parquet");
  });
});
