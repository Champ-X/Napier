import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  generateWebDesignCss,
  parseDesignTokenSource,
} from "./generate-web-design-tokens.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(scriptPath), "..");
const tokenCssPath = "apps/web/src/styles/tokens.css";
const debtPath = "docs/web-design-debt.json";
const literalColorPattern = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi;
const subTwelveTextPattern =
  /font-size:\s*(?:[0-9](?:\.[0-9]+)?|1[01](?:\.[0-9]+)?)px/gi;

export async function auditWebDesign(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const errors = [];
  const markdown = await readFile(path.join(repoRoot, "DESIGN.md"), "utf8");
  const source = parseDesignTokenSource(markdown);
  auditRequiredSections(markdown, errors);
  auditMirroredColors(markdown, source, errors);
  auditContrast(source, errors);

  const expectedCss = generateWebDesignCss(markdown);
  const currentCss = await readFile(
    path.join(repoRoot, tokenCssPath),
    "utf8",
  ).catch(() => "");
  if (currentCss !== expectedCss) {
    errors.push(`${tokenCssPath} is stale; run npm run generate:web-design`);
  }

  const sourceFiles = await collectFiles(path.join(repoRoot, "apps/web/src"));
  const cssFiles = sourceFiles.filter((file) => file.endsWith(".css"));
  const cssSources = new Map(
    await Promise.all(
      cssFiles.map(async (file) => [
        toRepoPath(repoRoot, file),
        await readFile(file, "utf8"),
      ]),
    ),
  );
  auditCssVariables(cssSources, errors);

  const debt = JSON.parse(
    await readFile(path.join(repoRoot, debtPath), "utf8"),
  );
  const literalColors = auditDebt(
    cssSources,
    debt.literalColors,
    literalColorPattern,
    tokenCssPath,
    "literal color",
    errors,
  );
  const subTwelveText = auditDebt(
    cssSources,
    debt.subTwelveText,
    subTwelveTextPattern,
    tokenCssPath,
    "sub-12px text",
    errors,
  );

  return {
    ok: errors.length === 0,
    errors,
    cssFileCount: cssFiles.length,
    definedVariableCount: countCssVariables(cssSources, "definitions"),
    usedVariableCount: countCssVariables(cssSources, "uses"),
    literalColorDebt: literalColors,
    subTwelveTextDebt: subTwelveText,
  };
}

function auditRequiredSections(markdown, errors) {
  for (const section of [
    "## 0. Meta",
    "## 1. Brand",
    "## 2. Color",
    "## 3. Typography",
    "## 4. Spacing",
    "## 5. Radius",
    "## 6. Elevation",
    "## 7. Motion",
    "## 8. Component State",
    "## 9. Layout",
    "## 10. Agent",
  ]) {
    if (!markdown.includes(section))
      errors.push(`DESIGN.md is missing ${section}`);
  }
  for (const term of [
    "focus-visible",
    "forced-colors",
    "prefers-reduced-motion",
    "default",
    "hover",
    "active",
    "disabled",
    "loading",
    "error",
    "readonly",
  ]) {
    if (!markdown.includes(term)) errors.push(`DESIGN.md is missing ${term}`);
  }
}

function auditMirroredColors(markdown, source, errors) {
  const mirrored = new Map();
  const blockPattern = /```tokens\s+color\.([\w.-]+)\n([\s\S]*?)```/g;
  for (const block of markdown.matchAll(blockPattern)) {
    for (const line of block[2].split("\n")) {
      const entry = line.match(/^-\s+([\w-]+)\s*\(color\):\s*(\S+)/);
      if (entry) mirrored.set(`${block[1]}.${entry[1]}`, entry[2]);
    }
  }
  const expected = new Map();
  for (const group of ["neutral", "brand", "ink", "trajectory"]) {
    for (const [name, token] of Object.entries(source.color?.[group] ?? {})) {
      expected.set(`${group}.${name}`, token.$value);
    }
  }
  for (const group of ["success", "warning", "danger"]) {
    for (const [name, token] of Object.entries(source.color?.[group] ?? {})) {
      expected.set(`status.${group}-${name}`, token.$value);
    }
  }
  for (const [name, value] of expected) {
    if (mirrored.get(name) !== value) {
      errors.push(`DESIGN.md mirrored primitive ${name} must equal ${value}`);
    }
  }
  if (mirrored.size !== expected.size) {
    errors.push(
      `DESIGN.md mirrored primitive count ${mirrored.size} does not match canonical count ${expected.size}`,
    );
  }
}

function auditContrast(source, errors) {
  const tokens = flattenTokens(source);
  const pairs = [
    ["semantic.color.fg", "semantic.color.bg", 4.5],
    ["semantic.color.fg", "semantic.color.surface", 4.5],
    ["semantic.color.fg-muted", "semantic.color.bg", 4.5],
    ["semantic.color.fg-muted", "semantic.color.surface", 4.5],
    ["semantic.color.fg-on-accent", "semantic.color.accent", 4.5],
    ["semantic.color.focus-ring", "semantic.color.surface", 3],
    ["semantic.color.border-strong", "semantic.color.surface", 3],
    ["semantic.color.navigation-fg", "semantic.color.navigation-bg", 4.5],
    ["semantic.color.navigation-fg-muted", "semantic.color.navigation-bg", 4.5],
    ["semantic.color.execution-spine", "semantic.color.paper", 3],
  ];
  for (const [fgPath, bgPath, minimum] of pairs) {
    const fg = resolveAlias(fgPath, tokens);
    const bg = resolveAlias(bgPath, tokens);
    const ratio = contrastRatio(fg, bg);
    if (ratio < minimum) {
      errors.push(
        `${fgPath} on ${bgPath} is ${ratio.toFixed(2)}:1; expected ${minimum}:1`,
      );
    }
  }
}

function auditCssVariables(cssSources, errors) {
  const definitions = new Set();
  const uses = new Set();
  for (const [file, source] of cssSources) {
    for (const match of source.matchAll(/(--[\w-]+)\s*:/g)) {
      definitions.add(match[1]);
    }
    for (const match of source.matchAll(/var\((--[\w-]+)/g)) uses.add(match[1]);
    for (const match of source.matchAll(/(--[\w-]+)\s*:\s*var\(\1\)/g)) {
      errors.push(`${file} defines self-referential ${match[1]}`);
    }
  }
  for (const variable of [...uses].sort()) {
    if (!definitions.has(variable))
      errors.push(`undefined CSS variable ${variable}`);
  }
}

function auditDebt(sources, baseline, pattern, excluded, label, errors) {
  const counts = {};
  let total = 0;
  for (const [file, source] of sources) {
    if (file === excluded) continue;
    const count = [
      ...source.matchAll(new RegExp(pattern.source, pattern.flags)),
    ].length;
    if (count > 0) counts[file] = count;
    total += count;
    const maximum = baseline?.[file] ?? 0;
    if (count > maximum) {
      errors.push(
        `${file} has ${count} ${label} occurrences; baseline allows ${maximum}`,
      );
    }
  }
  return { total, files: counts };
}

function flattenTokens(source) {
  const tokens = new Map();
  const visit = (value, segments) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    if (Object.hasOwn(value, "$value")) {
      tokens.set(segments.join("."), value.$value);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (!key.startsWith("$")) visit(child, [...segments, key]);
    }
  };
  visit(source, []);
  return tokens;
}

function resolveAlias(tokenPath, tokens, stack = []) {
  if (stack.includes(tokenPath)) throw new Error(`token cycle at ${tokenPath}`);
  const value = tokens.get(tokenPath);
  if (typeof value !== "string") throw new Error(`${tokenPath} is not a color`);
  const alias = value.match(/^\{([\w.-]+)\}$/);
  return alias ? resolveAlias(alias[1], tokens, [...stack, tokenPath]) : value;
}

function contrastRatio(foreground, background) {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort(
    (left, right) => right - left,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

function luminance(hex) {
  const value = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(value))
    throw new Error(`unsupported color ${hex}`);
  const channels = [0, 2, 4].map((offset) =>
    parseInt(value.slice(offset, offset + 2), 16),
  );
  const linear = channels.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function countCssVariables(sources, kind) {
  const pattern =
    kind === "definitions" ? /(--[\w-]+)\s*:/g : /var\((--[\w-]+)/g;
  const values = new Set();
  for (const source of sources.values()) {
    for (const match of source.matchAll(pattern)) values.add(match[1]);
  }
  return values.size;
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory() ? collectFiles(target) : [target];
    }),
  );
  return nested.flat();
}

function toRepoPath(repoRoot, file) {
  return path.relative(repoRoot, file).split(path.sep).join("/");
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) {
  auditWebDesign()
    .then((result) => {
      if (!result.ok) {
        for (const error of result.errors) console.error(`- ${error}`);
        process.exitCode = 1;
        return;
      }
      console.log(
        `Web design contract passed: ${result.cssFileCount} CSS files, ${result.definedVariableCount} variables, ${result.literalColorDebt.total} literal-color debt, ${result.subTwelveTextDebt.total} sub-12px debt`,
      );
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
