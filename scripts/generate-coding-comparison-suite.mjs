import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  canonicalJson,
  createWorkspacePathSnapshot,
  sha256,
} from "../packages/runtime/dist/index.js";
import {
  codingBenchmarkAstSha256,
  loadCodingBenchmarkCase,
} from "../apps/cli/dist/coding-benchmark-case.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const DEFAULT_SEED = 20260804;

export async function generateCodingComparisonSuite({ outputDir, seed }) {
  if (!Number.isSafeInteger(seed) || seed < 1 || seed > 0xffff_ffff) {
    throw new Error("Coding comparison seed must be a uint32");
  }
  const random = mulberry32(seed);
  const cases = [
    lowBoundaryCase(random, seed),
    mediumMigrationCase(random, seed),
    highDebuggerCase(random, seed),
  ];
  await mkdir(outputDir, { recursive: false });
  const entries = [];
  for (const specification of cases) {
    const caseRoot = path.join(outputDir, specification.directory);
    const manifest = await writeCase(caseRoot, specification);
    await loadCodingBenchmarkCase(caseRoot);
    entries.push({
      caseId: manifest.id,
      complexity: specification.complexity,
      directory: specification.directory,
      contentSha256: manifest.contentSha256,
    });
  }
  const suiteContent = {
    type: "napier.generated-coding-comparison-suite",
    schemaVersion: 1,
    seed,
    generator: "generate-coding-comparison-suite.mjs",
    cases: entries,
  };
  const suite = {
    ...suiteContent,
    contentSha256: sha256(canonicalJson(suiteContent)),
  };
  await writeJson(path.join(outputDir, "suite.json"), suite);
  return suite;
}

async function writeCase(root, specification) {
  const fixtureRoot = path.join(root, "fixture");
  await Promise.all([
    mkdir(fixtureRoot, { recursive: true }),
    mkdir(path.join(root, "expected"), { recursive: true }),
    mkdir(path.join(root, "tests"), { recursive: true }),
  ]);
  for (const [relativePath, source] of Object.entries(specification.fixture)) {
    const target = path.join(fixtureRoot, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, source, "utf8");
  }
  const expectedPath = path.join(root, "expected", specification.targetPath);
  await mkdir(path.dirname(expectedPath), { recursive: true });
  await Promise.all([
    writeFile(path.join(root, "prompt.md"), specification.prompt, "utf8"),
    writeFile(expectedPath, specification.expectedTarget, "utf8"),
    writeFile(
      path.join(root, "tests/outcome.mjs"),
      specification.outcomeTest,
      "utf8",
    ),
  ]);
  const fixture = await createWorkspacePathSnapshot(fixtureRoot, fixtureRoot);
  if (fixture.truncated) throw new Error("Generated fixture was truncated");
  const targetBefore = specification.fixture[specification.targetPath];
  const content = {
    kind: "napier.coding-benchmark-case",
    schemaVersion: specification.requiredCompletedTools ? 3 : 2,
    id: specification.id,
    title: specification.title,
    promptPath: "prompt.md",
    fixturePath: "fixture",
    targetPath: specification.targetPath,
    expectedTargetPath: `expected/${specification.targetPath}`,
    allowedChangedPaths: specification.allowedChangedPaths,
    requiredTools: specification.requiredTools,
    ...(specification.requiredCompletedTools
      ? { requiredCompletedTools: specification.requiredCompletedTools }
      : {}),
    timeoutMs: 120_000,
    promptSha256: sha256(specification.prompt),
    fixtureSha256: fixture.sha256,
    targetBeforeSha256: sha256(targetBefore),
    expectedTargetSha256: sha256(specification.expectedTarget),
    expectedTargetAstSha256: codingBenchmarkAstSha256(
      specification.expectedTarget,
    ),
    outcomeTestPath: "tests/outcome.mjs",
    outcomeTestSha256: sha256(specification.outcomeTest),
  };
  const manifest = {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
  await writeJson(path.join(root, "manifest.json"), manifest);
  return manifest;
}

function lowBoundaryCase(random, seed) {
  const threshold = integer(random, 3_500, 9_000);
  const memberCost = integer(random, 150, 450);
  const guestCost = memberCost + integer(random, 150, 450);
  const targetPath = "src/shipping.js";
  const before = `export function shippingCostCents(subtotalCents, member) {
  if (!Number.isInteger(subtotalCents) || subtotalCents < 0) {
    throw new TypeError("subtotalCents must be a non-negative integer");
  }
  if (subtotalCents > ${threshold}) return 0;
  return member ? ${memberCost} : ${guestCost};
}
`;
  const expected = before.replace(
    `subtotalCents > ${threshold}`,
    `subtotalCents >= ${threshold}`,
  );
  return {
    id: `coding_seed_${seed}_boundary`,
    directory: "low-boundary",
    complexity: "low",
    title: `Fix randomized shipping boundary ${seed}`,
    targetPath,
    allowedChangedPaths: [targetPath],
    requiredTools: ["read_file", "apply_patch"],
    fixture: { [targetPath]: before },
    expectedTarget: expected,
    prompt: `Fix the boundary bug in \`${targetPath}\`.

\`shippingCostCents(subtotalCents, member)\` must return zero at or above
${threshold} cents. Below that threshold, members pay ${memberCost} cents and
non-members pay ${guestCost} cents. Preserve validation, inspect before editing,
modify only \`${targetPath}\`, and make the smallest correct change.
`,
    outcomeTest:
      outcomeHeader(targetPath) +
      `
assertEqual(shippingCostCents(${threshold - 1}, true), ${memberCost}, "member below");
assertEqual(shippingCostCents(${threshold - 1}, false), ${guestCost}, "guest below");
assertEqual(shippingCostCents(${threshold}, true), 0, "member boundary");
assertEqual(shippingCostCents(${threshold}, false), 0, "guest boundary");
assertEqual(shippingCostCents(${threshold + 1}, false), 0, "above");
${assertEqualSource()}
`,
  };
}

function mediumMigrationCase(random, seed) {
  const functionName = pick(random, [
    "calculateNetCents",
    "computeInvoiceCents",
    "priceAfterDiscountCents",
  ]);
  const defaultDiscount = integer(random, 0, 8);
  const targetPath = "src/pricing.js";
  const before = `export function ${functionName}(subtotalCents, discountPercent) {
  if (!Number.isInteger(subtotalCents) || subtotalCents < 0) {
    throw new TypeError("subtotalCents must be a non-negative integer");
  }
  if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > 100) {
    throw new TypeError("discountPercent must be an integer from 0 to 100");
  }
  return Math.round((subtotalCents * (100 - discountPercent)) / 100);
}
`;
  const expected = before.replace(
    `${functionName}(subtotalCents, discountPercent)`,
    `${functionName}({ subtotalCents, discountPercent = ${defaultDiscount} })`,
  );
  const checkout = `import { ${functionName} } from "./pricing.js";

export function checkoutTotalCents(order) {
  return ${functionName}(order.subtotalCents, order.discountPercent);
}
`;
  const quote = `import { ${functionName} } from "./pricing.js";

export function quoteTotalCents(subtotalCents, discountPercent = ${defaultDiscount}) {
  return ${functionName}(subtotalCents, discountPercent);
}
`;
  return {
    id: `coding_seed_${seed}_migration`,
    directory: "medium-migration",
    complexity: "medium",
    title: `Migrate randomized pricing API ${seed}`,
    targetPath,
    allowedChangedPaths: ["src/checkout.js", "src/pricing.js", "src/quote.js"],
    requiredTools: ["list_files", "read_file", "lsp_references", "apply_patch"],
    fixture: {
      "package.json": '{\n  "type": "module"\n}\n',
      "jsconfig.json":
        '{\n  "compilerOptions": { "checkJs": true, "strict": true },\n  "include": ["src/**/*.js"]\n}\n',
      [targetPath]: before,
      "src/checkout.js": checkout,
      "src/quote.js": quote,
    },
    expectedTarget: expected,
    prompt: `Migrate \`${functionName}\` in \`${targetPath}\` from two positional
arguments to one options object with \`subtotalCents\` and optional
\`discountPercent\`, defaulting to ${defaultDiscount}. Preserve validation and
rounding. Use \`list_files\` once, use \`lsp_references\` before editing, inspect
every affected file, and update every call site. Modify only the three files in
\`src\`.
`,
    outcomeTest: `import { ${functionName} } from "./src/pricing.js";
import { checkoutTotalCents } from "./src/checkout.js";
import { quoteTotalCents } from "./src/quote.js";
assertEqual(${functionName}({ subtotalCents: 10000, discountPercent: 25 }), 7500, "object");
assertEqual(${functionName}({ subtotalCents: 10000 }), ${10_000 - defaultDiscount * 100}, "default");
assertEqual(checkoutTotalCents({ subtotalCents: 8000, discountPercent: 20 }), 6400, "checkout");
assertEqual(quoteTotalCents(10000), ${10_000 - defaultDiscount * 100}, "quote");
let rejected = false;
try { ${functionName}(10000, 25); } catch (error) { rejected = error instanceof TypeError; }
if (!rejected) throw new Error("legacy positional API must fail");
${assertEqualSource()}
`,
  };
}

function highDebuggerCase(random, seed) {
  const subtotal = integer(random, 2_000, 8_000);
  const percent = integer(random, 12, 25);
  const expectedTotal = subtotal - Math.round((subtotal * percent) / 100);
  const targetPath = "src/loyalty.js";
  const before = `export function loyaltyTotalCents(subtotalCents, tier) {
  if (!Number.isInteger(subtotalCents) || subtotalCents < 0) {
    throw new TypeError("subtotalCents must be a non-negative integer");
  }
  if (tier !== "none" && tier !== "gold") {
    throw new TypeError("tier must be none or gold");
  }
  const discountPercent = tier === "gold" ? ${percent} : 0;
  const discountCents = Math.round(discountPercent);
  return subtotalCents - discountCents;
}

globalThis.BENCHMARK_TOTAL = loyaltyTotalCents(${subtotal}, "gold");
`;
  const expected = before.replace(
    "Math.round(discountPercent)",
    "Math.round((subtotalCents * discountPercent) / 100)",
  );
  return {
    id: `coding_seed_${seed}_debugger`,
    directory: "high-debugger",
    complexity: "high",
    title: `Debug randomized loyalty calculation ${seed}`,
    targetPath,
    allowedChangedPaths: [targetPath],
    requiredTools: ["read_file", "node_debugger", "apply_patch"],
    requiredCompletedTools: ["node_debugger"],
    fixture: {
      "package.json": '{\n  "type": "module"\n}\n',
      [targetPath]: before,
    },
    expectedTarget: expected,
    prompt: `The log shows \`loyaltyTotalCents(${subtotal}, "gold")\` returns
${subtotal - percent}, but a ${percent}% discount should return ${expectedTotal}.
Inspect \`${targetPath}\`, then use \`node_debugger\` before editing. Pause after
the discount calculation and inspect live values. Make the smallest repair,
modify only \`${targetPath}\`, preserve validation and rounding, then finish.
`,
    outcomeTest:
      outcomeHeader(targetPath, "loyaltyTotalCents") +
      `
assertEqual(loyaltyTotalCents(${subtotal}, "gold"), ${expectedTotal}, "gold");
assertEqual(loyaltyTotalCents(${subtotal}, "none"), ${subtotal}, "none");
assertEqual(globalThis.BENCHMARK_TOTAL, ${expectedTotal}, "module total");
${assertEqualSource()}
`,
  };
}

function outcomeHeader(targetPath, exportName = "shippingCostCents") {
  return `const source = await (await import("node:fs/promises")).readFile(new URL("./${targetPath}", import.meta.url), "utf8");
const moduleUrl = \`data:text/javascript;base64,\${Buffer.from(source).toString("base64")}\`;
const { ${exportName} } = await import(moduleUrl);
`;
}

function assertEqualSource() {
  return `function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(\`\${label}: expected \${expected}, received \${actual}\`);
}`;
}

function integer(random, minimum, maximum) {
  return minimum + Math.floor(random() * (maximum - minimum + 1));
}

function pick(random, values) {
  return values[Math.floor(random() * values.length)];
}

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { seed, outputDir } = parseArgs(process.argv.slice(2));
  const suite = await generateCodingComparisonSuite({ seed, outputDir });
  process.stdout.write(`${JSON.stringify(suite, null, 2)}\n`);
}

function parseArgs(argv) {
  let seed = DEFAULT_SEED;
  let outputDir;
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!value || !["--seed", "--output-dir"].includes(flag)) {
      throw new Error("Usage: --seed <uint32> --output-dir <path>");
    }
    if (flag === "--seed") {
      if (!/^[0-9]+$/u.test(value)) throw new Error("Seed must be a uint32");
      seed = Number(value);
    } else {
      outputDir = path.resolve(value);
    }
  }
  return {
    seed,
    outputDir:
      outputDir ??
      path.join(
        repoRoot,
        "benchmark-results",
        `generated-coding-suite-${seed}`,
      ),
  };
}
