import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { auditWebDesign } from "./check-web-design.mjs";
import {
  generateWebDesignCss,
  parseDesignTokenSource,
} from "./generate-web-design-tokens.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");

describe("Napier Web design tokens", () => {
  it("parses the canonical DTCG source and generates semantic CSS", async () => {
    const markdown = await readFile(path.join(repoRoot, "DESIGN.md"), "utf8");
    const source = parseDesignTokenSource(markdown);
    const css = generateWebDesignCss(markdown);

    expect(source.semantic.color.accent.$value).toBe("{color.brand.600}");
    expect(css).toContain("--color-accent: #3A58EC;");
    expect(css).toContain("--color-focus-ring: #4D6BFE;");
    expect(css).toContain("--color-navigation-bg: #10141B;");
    expect(css).toContain("--color-execution-spine: #4D6BFE;");
    expect(css).toContain("--layout-command-bar: 58px;");
    expect(css).toContain("--layout-composer-shell: 72px;");
    expect(css).toContain("--layout-reading-target: 800px;");
    expect(css).not.toContain("--color-brand-600");
  });

  it("is byte-for-byte deterministic", async () => {
    const markdown = await readFile(path.join(repoRoot, "DESIGN.md"), "utf8");

    expect(generateWebDesignCss(markdown)).toBe(generateWebDesignCss(markdown));
  });

  it("rejects an unresolved semantic alias", async () => {
    const markdown = await readFile(path.join(repoRoot, "DESIGN.md"), "utf8");
    const invalid = markdown.replace(
      '"{color.brand.600}"',
      '"{color.brand.missing}"',
    );

    expect(() => generateWebDesignCss(invalid)).toThrow(
      "DESIGN.md token alias does not exist: color.brand.missing",
    );
  });

  it("passes the repository design audit", async () => {
    const result = await auditWebDesign({ repoRoot });

    expect(result).toMatchObject({ ok: true, errors: [] });
    expect(result.definedVariableCount).toBeGreaterThan(100);
    expect(result.literalColorDebt.total).toBe(825);
    expect(result.subTwelveTextDebt.total).toBe(0);
  });
});
