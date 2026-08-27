import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import ts from "typescript";

export async function analyzeRepository(repoRoot) {
  const workspacePackages = await discoverWorkspacePackages(repoRoot);
  const filePaths = [];
  for (const root of ["apps", "packages"]) {
    await collectTypeScriptFiles(path.join(repoRoot, root), filePaths);
  }
  filePaths.sort();

  const files = await Promise.all(
    filePaths.map(async (absolutePath) => {
      const source = await readFile(absolutePath, "utf8");
      const relativePath = toRepoPath(repoRoot, absolutePath);
      const sourceFile = ts.createSourceFile(
        relativePath,
        source,
        ts.ScriptTarget.Latest,
        true,
        relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      return {
        path: relativePath,
        absolutePath,
        kind: relativePath.includes("/test/") ? "test" : "source",
        lines: countLines(source),
        maxFunctionComplexity: maximumFunctionComplexity(sourceFile),
        publicExportCount: countPublicExports(sourceFile),
        moduleSpecifiers: collectModuleSpecifiers(sourceFile),
        workspace: workspaceForPath(relativePath, workspacePackages),
      };
    }),
  );
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  const sourceFiles = files.filter((file) => file.kind === "source");
  const graph = new Map(
    sourceFiles.map((file) => [
      file.path,
      relativeDependencies(file, filesByPath, repoRoot),
    ]),
  );

  return {
    files,
    filesByPath,
    sourceFiles,
    graph,
    cycles: dependencyCycles(graph),
    workspacePackages,
  };
}

export function collectDependencyMetrics(analysis) {
  const fanIn = new Map(
    [...analysis.graph.keys()].map((filePath) => [filePath, 0]),
  );
  for (const dependencies of analysis.graph.values()) {
    for (const dependency of dependencies) {
      fanIn.set(dependency, (fanIn.get(dependency) ?? 0) + 1);
    }
  }
  const sourceFiles = Object.fromEntries(
    analysis.sourceFiles
      .map((file) => {
        const sourceFanIn = fanIn.get(file.path) ?? 0;
        const sourceFanOut = (analysis.graph.get(file.path) ?? []).length;
        return [
          file.path,
          {
            fanIn: sourceFanIn,
            fanOut: sourceFanOut,
            changeCoupling: sourceFanIn * sourceFanOut,
          },
        ];
      })
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  const workspaceGraph = new Map(
    analysis.workspacePackages.map((workspace) => [
      workspace.name,
      { afferent: new Set(), efferent: new Set() },
    ]),
  );
  for (const file of analysis.sourceFiles) {
    if (!file.workspace) continue;
    for (const specifier of file.moduleSpecifiers) {
      const dependency = napierPackageName(specifier);
      if (
        !dependency ||
        dependency === file.workspace.name ||
        !workspaceGraph.has(dependency)
      ) {
        continue;
      }
      workspaceGraph.get(file.workspace.name).efferent.add(dependency);
      workspaceGraph.get(dependency).afferent.add(file.workspace.name);
    }
  }
  const workspaces = Object.fromEntries(
    [...workspaceGraph.entries()]
      .map(([name, dependencies]) => {
        const afferent = dependencies.afferent.size;
        const efferent = dependencies.efferent.size;
        const total = afferent + efferent;
        return [
          name,
          {
            afferent,
            efferent,
            instability: total === 0 ? 0 : efferent / total,
          },
        ];
      })
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  return { sourceFiles, workspaces };
}

async function discoverWorkspacePackages(repoRoot) {
  const packages = [];
  for (const root of ["apps", "packages"]) {
    const absoluteRoot = path.join(repoRoot, root);
    let entries = [];
    try {
      entries = await readdir(absoluteRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const packagePath = path.join(absoluteRoot, entry.name, "package.json");
      try {
        const manifest = JSON.parse(await readFile(packagePath, "utf8"));
        if (typeof manifest.name === "string") {
          packages.push({
            name: manifest.name,
            path: `${root}/${entry.name}/`,
          });
        }
      } catch {
        continue;
      }
    }
  }
  return packages.sort((left, right) => left.path.localeCompare(right.path));
}

async function collectTypeScriptFiles(directory, output) {
  let entries = [];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (
      entry.name === "dist" ||
      entry.name === "node_modules" ||
      entry.name.startsWith(".")
    ) {
      continue;
    }
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectTypeScriptFiles(absolutePath, output);
    } else if (
      entry.isFile() &&
      /\.(?:ts|tsx)$/.test(entry.name) &&
      (absolutePath.includes(`${path.sep}src${path.sep}`) ||
        absolutePath.includes(`${path.sep}test${path.sep}`))
    ) {
      output.push(absolutePath);
    }
  }
}

function relativeDependencies(file, filesByPath, repoRoot) {
  const dependencies = new Set();
  for (const specifier of file.moduleSpecifiers) {
    if (!specifier.startsWith(".")) continue;
    const resolved = resolveRelativeSource(
      file.absolutePath,
      specifier,
      filesByPath,
      repoRoot,
    );
    if (resolved) dependencies.add(resolved);
  }
  return [...dependencies].sort();
}

function resolveRelativeSource(fromPath, specifier, filesByPath, repoRoot) {
  const unresolved = path.resolve(path.dirname(fromPath), specifier);
  const extension = path.extname(unresolved);
  const candidates = [];
  if ([".js", ".jsx", ".mjs", ".cjs"].includes(extension)) {
    const base = unresolved.slice(0, -extension.length);
    candidates.push(`${base}.ts`, `${base}.tsx`);
  } else if (extension === ".ts" || extension === ".tsx") {
    candidates.push(unresolved);
  } else if (!extension) {
    candidates.push(
      `${unresolved}.ts`,
      `${unresolved}.tsx`,
      path.join(unresolved, "index.ts"),
      path.join(unresolved, "index.tsx"),
    );
  }
  for (const candidate of candidates) {
    const relative = toRepoPath(repoRoot, candidate);
    if (filesByPath.has(relative)) return relative;
  }
  return undefined;
}

function dependencyCycles(graph) {
  const indexByNode = new Map();
  const lowLinkByNode = new Map();
  const stack = [];
  const onStack = new Set();
  const components = [];
  let nextIndex = 0;

  function visit(node) {
    indexByNode.set(node, nextIndex);
    lowLinkByNode.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    onStack.add(node);
    for (const dependency of graph.get(node) ?? []) {
      if (!graph.has(dependency)) continue;
      if (!indexByNode.has(dependency)) {
        visit(dependency);
        lowLinkByNode.set(
          node,
          Math.min(lowLinkByNode.get(node), lowLinkByNode.get(dependency)),
        );
      } else if (onStack.has(dependency)) {
        lowLinkByNode.set(
          node,
          Math.min(lowLinkByNode.get(node), indexByNode.get(dependency)),
        );
      }
    }
    if (lowLinkByNode.get(node) !== indexByNode.get(node)) return;
    const component = [];
    while (stack.length > 0) {
      const member = stack.pop();
      onStack.delete(member);
      component.push(member);
      if (member === node) break;
    }
    const selfCycle =
      component.length === 1 &&
      (graph.get(component[0]) ?? []).includes(component[0]);
    if (component.length > 1 || selfCycle) components.push(component.sort());
  }

  for (const node of [...graph.keys()].sort()) {
    if (!indexByNode.has(node)) visit(node);
  }
  return components.sort((left, right) =>
    cycleKey(left).localeCompare(cycleKey(right)),
  );
}

function maximumFunctionComplexity(sourceFile) {
  let maximum = 1;
  function visit(node) {
    if (isFunctionLikeWithBody(node)) {
      maximum = Math.max(maximum, functionComplexity(node.body));
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return maximum;
}

function functionComplexity(body) {
  let complexity = 1;
  function visit(node) {
    if (node !== body && isFunctionLikeWithBody(node)) return;
    if (
      ts.isIfStatement(node) ||
      ts.isForStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isForOfStatement(node) ||
      ts.isWhileStatement(node) ||
      ts.isDoStatement(node) ||
      ts.isCatchClause(node) ||
      ts.isConditionalExpression(node) ||
      ts.isCaseClause(node)
    ) {
      complexity += 1;
    } else if (
      ts.isBinaryExpression(node) &&
      [
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken,
      ].includes(node.operatorToken.kind)
    ) {
      complexity += 1;
    }
    ts.forEachChild(node, visit);
  }
  visit(body);
  return complexity;
}

function isFunctionLikeWithBody(node) {
  return (
    (ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node) ||
      ts.isConstructorDeclaration(node)) &&
    node.body
  );
}

function countPublicExports(sourceFile) {
  let count = 0;
  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement)) {
      count +=
        statement.exportClause && ts.isNamedExports(statement.exportClause)
          ? statement.exportClause.elements.length
          : 1;
      continue;
    }
    const exported = statement.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    );
    if (!exported) continue;
    count += ts.isVariableStatement(statement)
      ? statement.declarationList.declarations.length
      : 1;
  }
  return count;
}

function collectModuleSpecifiers(sourceFile) {
  const specifiers = new Set();
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.add(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      specifiers.add(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return [...specifiers].sort();
}

function countLines(source) {
  if (source.length === 0) return 0;
  const lines = source.split(/\r\n|\r|\n/).length;
  return /(?:\r\n|\r|\n)$/.test(source) ? lines - 1 : lines;
}

function workspaceForPath(filePath, packages) {
  return packages.find((workspace) => filePath.startsWith(workspace.path));
}

function napierPackageName(specifier) {
  return specifier.match(/^(@napier\/[^/]+)/u)?.[1];
}

export function cycleKey(cycle) {
  return [...cycle].sort().join("|");
}

export function toRepoPath(repoRoot, absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join("/");
}
