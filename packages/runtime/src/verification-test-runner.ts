import ts from "typescript";
import { canonicalJson, sha256 } from "./ed25519.js";
import { readVerificationTestSources } from "./verification-test-sources.js";

export interface TestRunnerSelection {
  runner: "node-test" | "vitest";
  targets: string[];
  sourceSha256: string;
}

/** Only unambiguous source evidence changes the existing Vitest default.
 * Explicit selection supports wrappers; ambiguous mixed scopes must be split
 * by the caller rather than silently dropping tests from one framework. */
export async function selectVerificationTestRunner(
  workspaceRoot: string,
  targets: string[],
  requested?: "node-test" | "vitest",
): Promise<TestRunnerSelection> {
  if (
    requested !== undefined &&
    requested !== "node-test" &&
    requested !== "vitest"
  )
    throw new Error("Unsupported test runner");
  if (requested === "vitest")
    return {
      runner: requested,
      targets,
      sourceSha256: sha256("explicit:vitest"),
    };
  const files = new Map<
    string,
    { hash: string; native: boolean; other: boolean }
  >();
  const discovery = await readVerificationTestSources(workspaceRoot, targets);
  if (discovery.incomplete) {
    throw new Error(
      "Test runner selection is incomplete; narrow the target or specify testRunner explicitly",
    );
  }
  for (const [file, { hash, source }] of discovery.files) {
    files.set(file, {
      hash,
      ...frameworkImports(file, source),
    });
  }
  const sourceSha256 = sha256(canonicalJson([...files].sort()));
  const native = [...files.values()].some((file) => file.native);
  if (!requested && !native) return { runner: "vitest", targets, sourceSha256 };
  if (discovery.hasLinks)
    throw new Error(
      "Native test runner selection cannot follow symbolic links",
    );
  if (!files.size)
    throw new Error("Native Node test scope contains no test files");
  if (
    !requested &&
    [...files.values()].some((file) => !file.native || file.other)
  )
    throw new Error(
      "Mixed or indirect test frameworks: verify separate targets or specify testRunner explicitly",
    );
  return {
    runner: "node-test",
    targets: [...files.keys()].sort(),
    sourceSha256,
  };
}

function frameworkImports(
  file: string,
  source: string,
): { native: boolean; other: boolean } {
  let native = false,
    other = false;
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const classify = (specifier: string) => {
    if (specifier === "node:test") native = true;
    if (
      specifier === "vitest" ||
      specifier === "@jest/globals" ||
      specifier === "mocha"
    )
      other = true;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && node.importClause) {
      const clause = node.importClause;
      if (
        clause.isTypeOnly ||
        (!clause.name &&
          clause.namedBindings &&
          ts.isNamedImports(clause.namedBindings) &&
          clause.namedBindings.elements.length > 0 &&
          clause.namedBindings.elements.every((item) => item.isTypeOnly))
      )
        return;
    }
    if (ts.isExportDeclaration(node) && node.isTypeOnly) return;
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      classify(node.moduleSpecifier.text);
    if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      ((ts.isIdentifier(node.expression) &&
        node.expression.text === "require") ||
        node.expression.kind === ts.SyntaxKind.ImportKeyword) &&
      ts.isStringLiteral(node.arguments[0]!)
    )
      classify(node.arguments[0]!.text);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return { native, other };
}
