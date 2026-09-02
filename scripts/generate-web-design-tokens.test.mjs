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
    expect(css).toContain("--color-accent: #34332F;");
    expect(css).toContain("--color-focus-ring: #5B5852;");
    expect(css).toContain("--color-navigation-bg: #F6F4F0;");
    expect(css).toContain("--color-execution-spine: #6F6A63;");
    expect(css).toContain("--layout-command-bar: 88px;");
    expect(css).toContain("--layout-composer-shell: 72px;");
    expect(css).toContain("--layout-reading-target: 760px;");
    expect(css).toContain("--layout-sidebar-expanded: 252px;");
    expect(css).toContain("--layout-evidence-rail: 760px;");
    expect(css).toContain("--layout-utility-rail: 420px;");
    expect(css).toContain("--component-disclosure-row-height: 32px;");
    expect(css).toContain("--component-inspector-width: 760px;");
    expect(css).toContain("--component-trajectory-preview-lines: 16;");
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
    expect(result.literalColorDebt.total).toBe(0);
    expect(result.subTwelveTextDebt.total).toBe(0);
  });
});
