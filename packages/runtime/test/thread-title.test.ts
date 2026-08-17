import { describe, expect, it } from "vitest";

import {
  buildThreadTitleMessages,
  deriveThreadTitleFromPrompt,
  isDefaultThreadTitle,
  parseThreadTitleResponse,
} from "../src/thread-title.js";

describe("thread title", () => {
  it("builds a same-language bounded prompt", () => {
    const messages = buildThreadTitleMessages(
      "  设计实现精美的网页来生动地介绍挂谷猜想  ",
    );
    expect(messages.user).toBe("设计实现精美的网页来生动地介绍挂谷猜想");
    expect(messages.system).toContain("same language");
  });

  it("parses a title, stripping quotes and trailing punctuation", () => {
    expect(parseThreadTitleResponse('"挂谷猜想的精美网页设计。"')).toBe(
      "挂谷猜想的精美网页设计",
    );
    expect(parseThreadTitleResponse("Kakeya Web Explainer\n\nextra")).toBe(
      "Kakeya Web Explainer",
    );
    expect(parseThreadTitleResponse("   ")).toBeUndefined();
  });

  it("rejects an answer-length response so the caller can fall back", () => {
    const long = "词".repeat(120);
    expect(parseThreadTitleResponse(long)).toBeUndefined();
  });

  it("clamps a moderately long title to the bound", () => {
    const title = "词".repeat(50);
    expect(parseThreadTitleResponse(title)?.length).toBe(40);
  });

  it("derives a fallback title from the first prompt", () => {
    expect(deriveThreadTitleFromPrompt("  修复轨迹显示   问题 ")).toBe(
      "修复轨迹显示 问题",
    );
    expect(deriveThreadTitleFromPrompt("   ")).toBeUndefined();
  });

  it("recognizes the default title", () => {
    expect(isDefaultThreadTitle("Untitled ledger")).toBe(true);
    expect(isDefaultThreadTitle("挂谷猜想")).toBe(false);
  });
});
