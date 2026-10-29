import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import ts from "typescript";

const execute = promisify(execFile);
const hash = (value) => createHash("sha256").update(value).digest("hex");
export const REFERENCE_COMMIT = "0560f00944804b151086269b190377c6f8a0a7ce";
const entries = ["tool-loop-guard", "agent-invocation-context", "task-memory-context"];

/** A private compile of unchanged Git source, never a rewrite of its algorithm.
 * Follow emitted Runtime imports so a baseline helper cannot import a candidate
 * local dependency by accident. Shared package dependencies remain separately bound. */
export async function materializePreparationReference(root, directory) {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "package.json"), '{"type":"module"}\n', { flag: "wx" });
  const pending = entries.map((name) => `${name}.js`);
  const seen = new Set(); const files = []; const externalImports = new Set();
  while (pending.length) {
    const filename = pending.shift();
    if (seen.has(filename)) continue;
    seen.add(filename);
    assert.ok(!filename.startsWith("../") && filename.endsWith(".js"));
    const sourcePath = `packages/runtime/src/${filename.slice(0, -3)}.ts`;
    const [{ stdout: source }, { stdout: blob }] = await Promise.all([
      execute("git", ["show", `${REFERENCE_COMMIT}:${sourcePath}`], { cwd: root, maxBuffer: 8 * 1024 * 1024 }),
      execute("git", ["rev-parse", `${REFERENCE_COMMIT}:${sourcePath}`], { cwd: root }),
    ]);
    const compiled = ts.transpileModule(source, {
      fileName: sourcePath, reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ES2022, verbatimModuleSyntax: true, esModuleInterop: true },
    });
    const errors = (compiled.diagnostics ?? []).filter((item) => item.category === ts.DiagnosticCategory.Error);
    assert.equal(errors.length, 0, `Pinned source transpilation failed: ${sourcePath}`);
    const importEdges = [];
    for (const specifier of emittedImports(compiled.outputText, filename)) {
      if (specifier.startsWith(".")) {
        assert.ok(specifier.endsWith(".js"), `Unhandled pinned relative import ${specifier}`);
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(filename), specifier));
        pending.push(target); importEdges.push({ specifier, kind: "private-runtime", target });
      } else {
        externalImports.add(specifier); importEdges.push({ specifier, kind: "shared-external" });
      }
    }
    const output = path.join(directory, filename); await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, compiled.outputText, { flag: "wx" });
    const sourceOutput = `${filename.slice(0, -3)}.source.ts`;
    await writeFile(path.join(directory, sourceOutput), source, { flag: "wx" });
    files.push({ sourcePath, gitBlobOid: blob.trim(), sourceSha256: hash(source), sourceOutput, output: filename, emittedSha256: hash(compiled.outputText), importEdges });
  }
  const manifest = {
    commit: REFERENCE_COMMIT, entries, typescriptVersion: ts.version, target: "ES2023", module: "ES2022",
    method: "TypeScript transpileModule with unchanged Git source and unchanged relative import specifiers",
    files: files.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath)), externalImports: [...externalImports].sort(),
  };
  await writeFile(path.join(directory, "reference-manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  return manifest;
}

export async function verifyPreparationReference(directory, manifest) {
  for (const file of manifest.files) {
    assert.equal(hash(await readFile(path.join(directory, file.output))), file.emittedSha256, `Pinned reference changed: ${file.output}`);
    assert.equal(hash(await readFile(path.join(directory, file.sourceOutput))), file.sourceSha256, `Pinned source changed: ${file.sourceOutput}`);
  }
}

function emittedImports(source, filename) {
  const parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.ES2023, true, ts.ScriptKind.JS);
  const values = new Set();
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) values.add(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      assert.ok(node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]), `Unresolved dynamic import in pinned ${filename}`);
      values.add(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed); return [...values].sort();
}
