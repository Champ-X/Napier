import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  analyzeRepository,
  cycleKey,
  toRepoPath,
} from "./architecture-analysis.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(scriptPath), "..");
const defaultConfigPath = "docs/architecture-budget.json";
const defaultPolicy = {
  sourceMaxLines: 500,
  testMaxLines: 1_000,
  maxFunctionComplexity: 25,
};
const defaultPublicEntries = [
  "packages/contracts/src/index.ts",
  "packages/contracts/src/execution-channels.ts",
  "packages/contracts/src/execution-core.ts",
  "packages/contracts/src/execution-experiments.ts",
  "packages/contracts/src/execution-runs.ts",
  "packages/contracts/src/execution-workflows.ts",
  "packages/contracts/src/management-http.ts",
  "packages/contracts/src/workflow-experiments.ts",
  "packages/runtime/src/index.ts",
  "packages/sdk/src/index.ts",
  "packages/sdk/src/management.ts",
];
const defaultWorkspaceImports = {
  "@napier/contracts": [],
  "@napier/runtime": ["@napier/contracts"],
  "@napier/sdk": ["@napier/contracts", "@napier/runtime"],
  "@napier/cli": ["@napier/contracts", "@napier/runtime"],
  "@napier/server": ["@napier/contracts", "@napier/runtime"],
  "@napier/web": ["@napier/contracts"],
};

export async function createArchitectureBaseline(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const policy = {
    sourceMaxLines: options.sourceMaxLines ?? defaultPolicy.sourceMaxLines,
    testMaxLines: options.testMaxLines ?? defaultPolicy.testMaxLines,
    maxFunctionComplexity:
      options.maxFunctionComplexity ?? defaultPolicy.maxFunctionComplexity,
  };
  const analysis = await analyzeRepository(repoRoot);
  const lineOverrides = {};
  const complexityOverrides = {};

  for (const file of analysis.files) {
    const defaultMaximum =
      file.kind === "source" ? policy.sourceMaxLines : policy.testMaxLines;
    if (file.lines > defaultMaximum) lineOverrides[file.path] = file.lines;
    if (
      file.kind === "source" &&
      file.maxFunctionComplexity > policy.maxFunctionComplexity
    ) {
      complexityOverrides[file.path] = file.maxFunctionComplexity;
    }
  }

  const publicExports = {};
  for (const entry of options.publicEntries ?? defaultPublicEntries) {
    const file = analysis.filesByPath.get(entry);
    if (file) publicExports[entry] = file.publicExportCount;
  }

  return {
    schemaVersion: 1,
    policy,
    lineOverrides: sortRecord(lineOverrides),
    complexityOverrides: sortRecord(complexityOverrides),
    publicExports: sortRecord(publicExports),
    allowedCycles: analysis.cycles,
    allowedWorkspaceImports: sortRecord(
      options.allowedWorkspaceImports ?? defaultWorkspaceImports,
    ),
  };
}

export async function auditArchitecture(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const configPath = path.resolve(
    repoRoot,
    options.configPath ?? defaultConfigPath,
  );
  const errors = [];
  const config = await readConfig(configPath, errors);
  const analysis = await analyzeRepository(repoRoot);

  if (!config) return createResult(analysis, errors, configPath, repoRoot);
  validateConfig(config, errors);
  if (errors.length > 0) {
    return createResult(analysis, errors, configPath, repoRoot);
  }

  auditLineBudgets(analysis, config, errors);
  auditComplexityBudgets(analysis, config, errors);
  auditPublicExports(analysis, config, errors);
  auditCycles(analysis, config, errors);
  auditWorkspaceImports(analysis, config, errors);
  return createResult(analysis, errors, configPath, repoRoot);
}

function auditLineBudgets(analysis, config, errors) {
  for (const file of analysis.files) {
    const defaultMaximum =
      file.kind === "source"
        ? config.policy.sourceMaxLines
        : config.policy.testMaxLines;
    const override = config.lineOverrides[file.path];
    const maximum = override ?? defaultMaximum;
    if (file.lines > maximum) {
      errors.push(
        `${file.path} has ${file.lines} lines, exceeding the ${maximum}-line budget`,
      );
    } else if (override !== undefined && file.lines < override) {
      errors.push(
        `${file.path} line override is stale: lower ${override} to ${file.lines}`,
      );
    }
  }
  auditKnownPaths(analysis, config.lineOverrides, "line override", errors);
}

function auditComplexityBudgets(analysis, config, errors) {
  for (const file of analysis.sourceFiles) {
    const override = config.complexityOverrides[file.path];
    const maximum = override ?? config.policy.maxFunctionComplexity;
    if (file.maxFunctionComplexity > maximum) {
      errors.push(
        `${file.path} has function complexity ${file.maxFunctionComplexity}, exceeding the ${maximum} budget`,
      );
    } else if (
      override !== undefined &&
      file.maxFunctionComplexity < override
    ) {
      errors.push(
        `${file.path} complexity override is stale: lower ${override} to ${file.maxFunctionComplexity}`,
      );
    }
  }
  auditKnownPaths(
    analysis,
    config.complexityOverrides,
    "complexity override",
    errors,
  );
}

function auditPublicExports(analysis, config, errors) {
  for (const [filePath, maximum] of Object.entries(config.publicExports)) {
    const file = analysis.filesByPath.get(filePath);
    if (!file) {
      errors.push(`public export entry does not exist: ${filePath}`);
      continue;
    }
    if (file.publicExportCount > maximum) {
      errors.push(
        `${filePath} has ${file.publicExportCount} public exports, exceeding the ${maximum} budget`,
      );
    } else if (file.publicExportCount < maximum) {
      errors.push(
        `${filePath} public export budget is stale: lower ${maximum} to ${file.publicExportCount}`,
      );
    }
  }
}

function auditCycles(analysis, config, errors) {
  const observed = new Set(analysis.cycles.map(cycleKey));
  const allowed = new Set(config.allowedCycles.map(cycleKey));
  for (const cycle of observed) {
    if (!allowed.has(cycle)) {
      errors.push(
        `new relative import cycle: ${cycle.replaceAll("|", " -> ")}`,
      );
    }
  }
  for (const cycle of allowed) {
    if (!observed.has(cycle)) {
      errors.push(
        `allowed relative import cycle is stale: ${cycle.replaceAll("|", " -> ")}`,
      );
    }
  }
}

function auditWorkspaceImports(analysis, config, errors) {
  for (const file of analysis.sourceFiles) {
    if (!file.workspace) continue;
    const allowed = new Set(
      config.allowedWorkspaceImports[file.workspace.name] ?? [],
    );
    for (const specifier of file.moduleSpecifiers) {
      const target = napierPackageName(specifier);
      if (target && target !== file.workspace.name && !allowed.has(target)) {
        errors.push(
          `${file.path} imports forbidden workspace dependency ${target}`,
        );
      }
    }
  }
}

function auditKnownPaths(analysis, record, label, errors) {
  for (const filePath of Object.keys(record)) {
    if (!analysis.filesByPath.has(filePath)) {
      errors.push(`${label} path does not exist: ${filePath}`);
    }
  }
}

function validateConfig(config, errors) {
  if (config.schemaVersion !== 1) {
    errors.push("architecture budget schemaVersion must be 1");
  }
  for (const field of [
    "sourceMaxLines",
    "testMaxLines",
    "maxFunctionComplexity",
  ]) {
    const value = config.policy?.[field];
    if (!Number.isSafeInteger(value) || value < 1) {
      errors.push(`architecture policy ${field} must be a positive integer`);
    }
  }
  for (const field of [
    "lineOverrides",
    "complexityOverrides",
    "publicExports",
    "allowedWorkspaceImports",
  ]) {
    if (!isRecord(config[field])) {
      errors.push(`architecture budget ${field} must be an object`);
    }
  }
  if (!Array.isArray(config.allowedCycles)) {
    errors.push("architecture budget allowedCycles must be an array");
  }
}

async function readConfig(configPath, errors) {
  try {
    const parsed = JSON.parse(await readFile(configPath, "utf8"));
    if (!isRecord(parsed)) {
      errors.push("architecture budget must be a JSON object");
      return undefined;
    }
    return parsed;
  } catch (error) {
    errors.push(
      `cannot read architecture budget: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

function createResult(analysis, errors, configPath, repoRoot) {
  return {
    ok: errors.length === 0,
    errors,
    configPath: toRepoPath(repoRoot, configPath),
    sourceFileCount: analysis.sourceFiles.length,
    testFileCount: analysis.files.length - analysis.sourceFiles.length,
    cycleCount: analysis.cycles.length,
  };
}

function napierPackageName(specifier) {
  const match = specifier.match(/^(@napier\/[^/]+)/);
  return match?.[1];
}

function sortRecord(record) {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function runCli() {
  const options = parseCliOptions(process.argv.slice(2));
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  if (options.writeBaseline) {
    const baseline = await createArchitectureBaseline({ repoRoot });
    const outputPath = path.resolve(
      repoRoot,
      options.configPath ?? defaultConfigPath,
    );
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(
      `Architecture baseline written: ${toRepoPath(repoRoot, outputPath)}`,
    );
    return;
  }
  const result = await auditArchitecture({
    repoRoot,
    ...(options.configPath ? { configPath: options.configPath } : {}),
  });
  if (options.json) console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    if (!options.json) {
      console.error("Architecture audit failed:");
      for (const error of result.errors) console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }
  if (!options.json) {
    console.log(
      `Architecture audit passed: ${result.sourceFileCount} source files, ${result.testFileCount} test files, ${result.cycleCount} allowed cycles`,
    );
  }
}

function parseCliOptions(args) {
  const options = { json: false, writeBaseline: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") options.json = true;
    else if (argument === "--write-baseline") options.writeBaseline = true;
    else if (argument === "--repo-root" || argument === "--config") {
      const value = args[index + 1];
      if (!value) throw new Error(`${argument} requires a value`);
      if (argument === "--repo-root") options.repoRoot = value;
      else options.configPath = value;
      index += 1;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  return options;
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) {
  await runCli();
}
