import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import ts from "typescript";

import { analyzeRepository, toRepoPath } from "./architecture-analysis.mjs";

const execFile = promisify(execFileCallback);
const BASELINE_PATH = "docs/repository-hygiene-baseline.json";
const REGISTRY_PATH = "scripts/registry.json";
const SOURCE_EXTENSIONS = /\.(?:c|m)?(?:js|ts)x?$/u;
const NODE_BUILTIN = /^(?:node:|bun:)/u;
const RUNTIME_FACADE_ENTRIES = [
  "agent",
  "browser",
  "code",
  "core",
  "evaluation",
  "governance",
  "model",
  "store",
  "subagents",
  "tools",
  "workflow",
];

export async function readHygieneBaseline(repoRoot = process.cwd()) {
  const value = JSON.parse(
    await readFile(path.join(repoRoot, BASELINE_PATH), "utf8"),
  );
  if (value?.kind !== "napier.repository-hygiene-baseline") {
    throw new Error("Repository hygiene baseline has an invalid kind");
  }
  if (value?.schemaVersion !== 2) {
    throw new Error("Repository hygiene baseline has an invalid schemaVersion");
  }
  return value;
}

export async function readScriptRegistry(repoRoot = process.cwd()) {
  const value = JSON.parse(
    await readFile(path.join(repoRoot, REGISTRY_PATH), "utf8"),
  );
  if (
    value?.kind !== "napier.script-entry-registry" ||
    value?.schemaVersion !== 1
  ) {
    throw new Error("Script entry registry has an invalid contract");
  }
  const paths = new Set();
  const errors = [];
  for (const entry of value.entries ?? []) {
    const prefix = typeof entry?.path === "string" ? entry.path : "<unknown>";
    if (!/^(?:scripts\/|packages\/[^/]+\/src\/)/u.test(prefix)) {
      errors.push(`${prefix} must be a script or dynamic package entry`);
      continue;
    }
    if (paths.has(prefix))
      errors.push(`${prefix} is registered more than once`);
    paths.add(prefix);
    for (const field of [
      "kind",
      "owner",
      "entryCommand",
      "credentialClass",
      "retainedUntil",
    ]) {
      if (typeof entry[field] !== "string" || entry[field].trim() === "") {
        errors.push(`${prefix} has no ${field}`);
      }
    }
    if (typeof entry.networkRequired !== "boolean") {
      errors.push(`${prefix} has no networkRequired flag`);
    }
    if (!Array.isArray(entry.outputArtifacts)) {
      errors.push(`${prefix} has no outputArtifacts list`);
    }
    try {
      const file = await readFile(path.join(repoRoot, prefix));
      if (file.length === 0) errors.push(`${prefix} is empty`);
    } catch {
      errors.push(`${prefix} does not exist`);
    }
  }
  if (errors.length > 0) {
    throw new Error(
      `Script entry registry is invalid:\n- ${errors.join("\n- ")}`,
    );
  }
  return { ...value, paths };
}

export async function collectKnipIssues(repoRoot = process.cwd()) {
  const { stdout } = await execFile(
    process.execPath,
    [
      "node_modules/knip/bin/knip.js",
      "--include",
      "files,dependencies,unlisted,unresolved,binaries",
      "--reporter",
      "json",
      "--no-exit-code",
    ],
    { cwd: repoRoot, maxBuffer: 16 * 1024 * 1024 },
  );
  const report = JSON.parse(stdout);
  const issues = [];
  for (const group of report.issues ?? []) {
    for (const type of [
      "files",
      "dependencies",
      "unlisted",
      "unresolved",
      "binaries",
    ]) {
      for (const issue of group[type] ?? []) {
        issues.push({
          type,
          file: type === "files" ? issue.name : group.file,
          name: issue.name,
        });
      }
    }
  }
  return issues;
}

export async function productionUnreachableWebFiles(repoRoot = process.cwd()) {
  const analysis = await analyzeRepository(repoRoot);
  const reachable = graphClosure(analysis.graph, [
    "apps/web/src/main.tsx",
    "apps/web/src/kernel-browser-inspector-slot.ts",
    ...analysis.sourceFiles
      .map((file) => file.path)
      .filter(
        (file) => file.startsWith("apps/web/src/") && file.endsWith(".zh.ts"),
      ),
  ]);
  return analysis.sourceFiles
    .map((file) => file.path)
    .filter((file) => file.startsWith("apps/web/src/") && !reachable.has(file))
    .sort();
}

export async function collectDuplicateStatistics(repoRoot = process.cwd()) {
  const outputRoot = await mkdtemp(path.join(tmpdir(), "napier-jscpd-"));
  try {
    await execFile(
      process.execPath,
      [
        "node_modules/jscpd/run-jscpd.js",
        "apps/cli/src",
        "apps/server/src",
        "apps/web/src",
        "packages/benchmark-kit/src",
        "packages/contracts/src",
        "packages/harness-eval/src",
        "packages/runtime/src",
        "packages/sdk/src",
        "scripts",
        "--min-lines",
        "20",
        "--min-tokens",
        "150",
        "--mode",
        "strict",
        "--ignore",
        "**/test/**,**/*.test.*,**/dist/**",
        "--reporters",
        "json",
        "--output",
        outputRoot,
        "--silent",
      ],
      { cwd: repoRoot, maxBuffer: 1024 * 1024 },
    );
    const report = JSON.parse(
      await readFile(path.join(outputRoot, "jscpd-report.json"), "utf8"),
    );
    return report.statistics.total;
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
}

export async function collectDesktopScope(repoRoot = process.cwd()) {
  const cssFiles = await collectFiles(
    path.join(repoRoot, "apps/web/src"),
    /\.css$/u,
  );
  let narrowViewportMediaBlocks = 0;
  for (const file of cssFiles) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(
      /@media[^{}]*\(\s*max-width\s*:\s*(\d+)px\s*\)/gu,
    )) {
      if (Number(match[1]) < 1_280) narrowViewportMediaBlocks += 1;
    }
  }
  const contractSource = await readFile(
    path.join(repoRoot, "scripts/web-ui-e2e-contract.mjs"),
    "utf8",
  );
  const supportedViewports = [
    ...contractSource.matchAll(/width:\s*([\d_]+),\s*height:\s*([\d_]+)/gu),
  ].map((match) => ({
    width: Number(match[1].replaceAll("_", "")),
    height: Number(match[2].replaceAll("_", "")),
  }));
  return { narrowViewportMediaBlocks, supportedViewports };
}

export async function collectDependencyOwnershipIssues(
  repoRoot = process.cwd(),
) {
  const workspacePackageNames = new Set();
  for (const workspaceRoot of ["apps", "packages"]) {
    for (const entry of await readdir(path.join(repoRoot, workspaceRoot), {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) continue;
      const workspaceManifest = await manifest(
        path.join(repoRoot, workspaceRoot, entry.name),
      );
      if (typeof workspaceManifest.name === "string")
        workspacePackageNames.add(workspaceManifest.name);
    }
  }
  const workspaces = [
    {
      root: repoRoot,
      roots: ["scripts"],
      manifest: await manifest(repoRoot),
      isRoot: true,
    },
  ];
  for (const workspaceRoot of ["apps", "packages"]) {
    for (const entry of await readdir(path.join(repoRoot, workspaceRoot), {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) continue;
      const relative = `${workspaceRoot}/${entry.name}`;
      const workspacePath = path.join(repoRoot, relative);
      workspaces.push({
        root: workspacePath,
        roots: ["src", "test", "examples"],
        manifest: await manifest(workspacePath),
        isRoot: false,
      });
    }
  }
  const issues = [];
  for (const workspace of workspaces) {
    const declared = new Set([
      ...Object.keys(workspace.manifest.dependencies ?? {}),
      ...Object.keys(workspace.manifest.devDependencies ?? {}),
      ...Object.keys(workspace.manifest.peerDependencies ?? {}),
      ...Object.keys(workspace.manifest.optionalDependencies ?? {}),
      ...(workspace.isRoot ? workspacePackageNames : []),
      ...(typeof workspace.manifest.name === "string"
        ? [workspace.manifest.name]
        : []),
    ]);
    for (const relativeRoot of workspace.roots) {
      for (const file of await collectFiles(
        path.join(workspace.root, relativeRoot),
        SOURCE_EXTENSIONS,
      )) {
        const source = await readFile(file, "utf8");
        const sourceFile = ts.createSourceFile(
          file,
          source,
          ts.ScriptTarget.Latest,
          true,
        );
        for (const specifier of moduleSpecifiers(sourceFile)) {
          if (
            specifier.startsWith(".") ||
            specifier.startsWith("/") ||
            specifier.startsWith("#") ||
            NODE_BUILTIN.test(specifier)
          )
            continue;
          const dependency = packageName(specifier);
          if (!declared.has(dependency)) {
            issues.push({ file: toRepoPath(repoRoot, file), dependency });
          }
        }
      }
    }
  }
  return issues.sort((left, right) =>
    `${left.file}:${left.dependency}`.localeCompare(
      `${right.file}:${right.dependency}`,
    ),
  );
}

export async function collectPublicApi(
  repoRoot = process.cwd(),
  facadeEntries = RUNTIME_FACADE_ENTRIES,
) {
  const runtimeIndex = await readFile(
    path.join(repoRoot, "packages/runtime/src/index.ts"),
    "utf8",
  );
  const analysis = await analyzeRepository(repoRoot);
  const runtimeManifest = await manifest(
    path.join(repoRoot, "packages/runtime"),
  );
  const runtimePackageExportNames = Object.keys(
    runtimeManifest.exports ?? {},
  ).sort();
  const runtimeProgram = await createRuntimeProgram(repoRoot);
  const runtimeRootSemanticExportNames = semanticExportNames(
    runtimeProgram,
    path.join(repoRoot, "packages/runtime/src/index.ts"),
  );
  const runtimeFacadeSemanticExports = {};
  const runtimeFacadeSemanticExportSha256 = {};
  for (const entry of facadeEntries) {
    const names = semanticExportNames(
      runtimeProgram,
      path.join(repoRoot, `packages/runtime/src/public/${entry}.ts`),
    );
    runtimeFacadeSemanticExports[entry] = names.length;
    runtimeFacadeSemanticExportSha256[entry] = sha256(names.join("\n"));
  }
  const runtimeInternalSemanticExportNames = semanticExportNames(
    runtimeProgram,
    path.join(repoRoot, "packages/runtime/src/internal.ts"),
  );
  const internalRuntimeRootImportFiles = analysis.sourceFiles.filter((file) =>
    file.moduleSpecifiers.includes("@napier/runtime"),
  ).length;
  let webDuplicateDefaultExports = 0;
  for (const file of analysis.sourceFiles.filter((candidate) =>
    candidate.path.startsWith("apps/web/src/"),
  )) {
    const source = await readFile(file.absolutePath, "utf8");
    const defaultName = source.match(
      /\bexport\s+default\s+([A-Za-z_$][\w$]*)/u,
    )?.[1];
    if (
      defaultName &&
      new RegExp(
        `\\bexport\\s+(?:async\\s+)?(?:function|class|const|let|var)\\s+${defaultName}\\b`,
        "u",
      ).test(source)
    ) {
      webDuplicateDefaultExports += 1;
    }
  }
  return {
    runtimeRootExports: [...runtimeIndex.matchAll(/^export\s+\*/gmu)].length,
    runtimeRootSemanticExports: runtimeRootSemanticExportNames.length,
    runtimeRootSemanticExportSha256: sha256(
      runtimeRootSemanticExportNames.join("\n"),
    ),
    runtimePackageExportKeys: runtimePackageExportNames.length,
    runtimePackageExportKeysSha256: sha256(
      runtimePackageExportNames.join("\n"),
    ),
    runtimeInternalSemanticExports: runtimeInternalSemanticExportNames.length,
    runtimeInternalSemanticExportSha256: sha256(
      runtimeInternalSemanticExportNames.join("\n"),
    ),
    runtimeFacadeSemanticExports,
    runtimeFacadeSemanticExportSha256,
    internalRuntimeRootImportFiles,
    webDuplicateDefaultExports,
  };
}

async function createRuntimeProgram(repoRoot) {
  const configPath = path.join(repoRoot, "packages/runtime/tsconfig.json");
  let parsed;
  if (ts.sys.fileExists(configPath)) {
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    if (config.error) {
      throw new Error(
        `Runtime TypeScript config is invalid: ${ts.flattenDiagnosticMessageText(config.error.messageText, "\n")}`,
      );
    }
    parsed = ts.parseJsonConfigFileContent(
      config.config,
      ts.sys,
      path.dirname(configPath),
    );
    if (parsed.errors.length > 0) {
      throw new Error(
        `Runtime TypeScript config is invalid: ${parsed.errors
          .map((error) =>
            ts.flattenDiagnosticMessageText(error.messageText, "\n"),
          )
          .join("; ")}`,
      );
    }
  } else {
    parsed = {
      fileNames: await collectFiles(
        path.join(repoRoot, "packages/runtime/src"),
        /\.tsx?$/u,
      ),
      options: {
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        target: ts.ScriptTarget.ES2023,
      },
    };
  }
  return ts.createProgram(parsed.fileNames, parsed.options);
}

function semanticExportNames(program, absolutePath) {
  const sourceFile = program.getSourceFile(path.resolve(absolutePath));
  const symbol = sourceFile
    ? program.getTypeChecker().getSymbolAtLocation(sourceFile)
    : undefined;
  if (!sourceFile || !symbol) {
    throw new Error(`Runtime public entry cannot be analyzed: ${absolutePath}`);
  }
  return program
    .getTypeChecker()
    .getExportsOfModule(symbol)
    .map((entry) => entry.getName())
    .sort();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function graphClosure(graph, entries) {
  const seen = new Set();
  const pending = [...entries];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    pending.push(...(graph.get(current) ?? []));
  }
  return seen;
}

async function collectFiles(directory, pattern) {
  const output = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return output;
  }
  for (const entry of entries) {
    if (
      entry.name === "dist" ||
      entry.name === "node_modules" ||
      entry.name.startsWith(".")
    )
      continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory())
      output.push(...(await collectFiles(target, pattern)));
    else if (entry.isFile() && pattern.test(entry.name)) output.push(target);
  }
  return output;
}

async function manifest(root) {
  try {
    return JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  } catch {
    return {};
  }
}

function moduleSpecifiers(sourceFile) {
  const output = new Set();
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      output.add(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require")) &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      output.add(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return output;
}

function packageName(specifier) {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}
