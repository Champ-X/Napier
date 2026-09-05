import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
const runtimeConfig = path.resolve(sourceRoot, "../tsconfig.json");

const admittedExecutionSurfaces = new Set([
  "agent-runtime-step-lifecycle.ts",
  "governed-code-bridge.ts",
  "tool-invocation-experiments.ts",
  "workflow-tool-runtime.ts",
]);

const invocationExemptions = new Set([
  "agent-tool-failure-capture.ts#wrapToolsWithFailureCapture",
  "doctor-runtime-probes.ts#probeSkillsRuntime",
  "subagent-worktree-verification.ts#SubagentWorktreeOperationCoordinator.wrapReadOnlyTool",
  "subagent-worktree-verification.ts#SubagentWorktreeOperationCoordinator.wrapMutationTool",
  "subagent-worktree-verification.ts#SubagentWorktreeOperationCoordinator.wrapVerificationTool",
  "subagent-worktree-verification.ts#SubagentWorktreeOperationCoordinator.wrapCommandTool",
]);

const referenceExemptions = new Set([
  "agent-tool-metadata.ts#agentToolImplementationSha256",
  "agent-tool-metadata.ts#preserveAgentToolIdentity",
  "agent-tool-result-lifecycle.ts#AgentToolResultLifecycle.captureExecutionFailures",
  "tool-deadline.ts#ToolDeadlineManager.wrapTool",
]);

let cachedRuntimeProgram:
  | { program: ts.Program; checker: ts.TypeChecker }
  | undefined;

interface AgentToolExecuteReference {
  readonly file: string;
  readonly owner: string;
  readonly line: number;
  readonly node: ts.PropertyAccessExpression | ts.ElementAccessExpression;
  readonly invocation: ts.CallExpression | undefined;
}

describe("unified tool execution admission structure", () => {
  it("routes every independent AgentTool execution through the admission service", () => {
    const { program, checker } = runtimeProgram();
    const references = agentToolExecuteReferences(program, checker);
    const violations = references.flatMap((reference) => {
      const identity = `${reference.file}#${reference.owner}`;
      if (reference.invocation) {
        if (
          isWithinAdmissionExecuteCallback(reference.node) ||
          invocationExemptions.has(identity)
        ) {
          return [];
        }
        return [
          diagnostic(reference, "invokes AgentTool.execute outside admission"),
        ];
      }
      if (referenceExemptions.has(identity)) return [];
      return [
        diagnostic(
          reference,
          "extracts AgentTool.execute outside an audited decorator",
        ),
      ];
    });

    expect(violations, violations.join("\n")).toEqual([]);
    for (const file of admittedExecutionSurfaces) {
      const calls = references.filter(
        (reference) => reference.file === file && reference.invocation,
      );
      expect(
        calls.length,
        `${file} must retain an auditable raw tool boundary`,
      ).toBeGreaterThan(0);
      expect(
        calls.filter((call) => !isWithinAdmissionExecuteCallback(call.node)),
        `${file} must delegate its raw tool boundary to executeAdmittedToolCall`,
      ).toEqual([]);
    }
  });

  it("wraps every SubagentTaskRunner Agent toolset in an admission delegate", () => {
    const { program, checker } = runtimeProgram();
    const source = program.getSourceFile(
      path.join(sourceRoot, "subagent-task-runner.ts"),
    );
    if (!source) throw new Error("SubagentTaskRunner source was not loaded");
    const toolsets = agentConstructorToolsets(source);

    expect(toolsets.length).toBeGreaterThan(0);
    const bypasses = toolsets
      .filter(
        (toolset) =>
          !delegatesToAdmission(toolset, checker, new Set<ts.Symbol>(), 0),
      )
      .map((toolset) => {
        const location = source.getLineAndCharacterOfPosition(
          toolset.getStart(),
        );
        return `subagent-task-runner.ts:${location.line + 1}`;
      });
    expect(
      bypasses,
      `Subagent Agent tools bypass executeAdmittedToolCall: ${bypasses.join(", ")}`,
    ).toEqual([]);
  });
});

function runtimeProgram(): { program: ts.Program; checker: ts.TypeChecker } {
  if (cachedRuntimeProgram) return cachedRuntimeProgram;
  const config = ts.readConfigFile(runtimeConfig, ts.sys.readFile);
  if (config.error) {
    throw new Error(
      ts.flattenDiagnosticMessageText(config.error.messageText, "\n"),
    );
  }
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    path.dirname(runtimeConfig),
    undefined,
    runtimeConfig,
  );
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  cachedRuntimeProgram = { program, checker: program.getTypeChecker() };
  return cachedRuntimeProgram;
}

function agentToolExecuteReferences(
  program: ts.Program,
  checker: ts.TypeChecker,
): AgentToolExecuteReference[] {
  const references: AgentToolExecuteReference[] = [];
  for (const source of program.getSourceFiles()) {
    if (
      source.isDeclarationFile ||
      !source.fileName.startsWith(sourceRoot) ||
      !source.fileName.endsWith(".ts")
    ) {
      continue;
    }
    visit(source, (node) => {
      if (
        !isExecuteAccess(node) ||
        !isAgentToolLike(accessReceiver(node), checker)
      ) {
        return;
      }
      const directCall =
        ts.isCallExpression(node.parent) && node.parent.expression === node
          ? node.parent
          : undefined;
      const location = source.getLineAndCharacterOfPosition(node.getStart());
      references.push({
        file: path.basename(source.fileName),
        owner: enclosingOwner(node),
        line: location.line + 1,
        node,
        ...(directCall
          ? { invocation: directCall }
          : { invocation: undefined }),
      });
    });
    assertNoAgentToolExecuteDestructuring(source, checker);
  }
  return references;
}

function isExecuteAccess(
  node: ts.Node,
): node is ts.PropertyAccessExpression | ts.ElementAccessExpression {
  return (
    (ts.isPropertyAccessExpression(node) && node.name.text === "execute") ||
    (ts.isElementAccessExpression(node) &&
      ts.isStringLiteral(node.argumentExpression) &&
      node.argumentExpression.text === "execute")
  );
}

function accessReceiver(
  node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
): ts.Expression {
  return node.expression;
}

function isAgentToolLike(
  node: ts.Expression,
  checker: ts.TypeChecker,
): boolean {
  const type = checker.getApparentType(checker.getTypeAtLocation(node));
  return ["name", "parameters", "execute"].every((property) =>
    checker.getPropertyOfType(type, property),
  );
}

function isWithinAdmissionExecuteCallback(node: ts.Node): boolean {
  for (
    let current: ts.Node | undefined = node;
    current;
    current = current.parent
  ) {
    if (
      !ts.isPropertyAssignment(current) ||
      propertyName(current.name) !== "execute" ||
      !ts.isObjectLiteralExpression(current.parent)
    ) {
      continue;
    }
    let container: ts.Node = current.parent;
    while (
      ts.isParenthesizedExpression(container.parent) ||
      ts.isAsExpression(container.parent) ||
      ts.isSatisfiesExpression(container.parent)
    ) {
      container = container.parent;
    }
    const call = container.parent;
    return (
      ts.isCallExpression(call) &&
      call.arguments.includes(container as ts.Expression) &&
      call.expression.getText() === "executeAdmittedToolCall"
    );
  }
  return false;
}

function agentConstructorToolsets(source: ts.SourceFile): ts.Expression[] {
  const toolsets: ts.Expression[] = [];
  visit(source, (node) => {
    if (
      !ts.isNewExpression(node) ||
      node.expression.getText(source) !== "Agent" ||
      !node.arguments?.[0] ||
      !ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      return;
    }
    const initialState = objectProperty(node.arguments[0], "initialState");
    if (!initialState || !ts.isObjectLiteralExpression(initialState)) return;
    const tools = objectProperty(initialState, "tools");
    if (tools) toolsets.push(tools);
  });
  return toolsets;
}

function delegatesToAdmission(
  node: ts.Node,
  checker: ts.TypeChecker,
  visited: Set<ts.Symbol>,
  depth: number,
): boolean {
  if (depth > 8) return false;
  const expression = unwrapExpression(node);
  const reference = referencedSymbol(node, checker);
  if (
    reference &&
    symbolDelegatesToAdmission(reference, checker, visited, depth)
  ) {
    return true;
  }
  if (ts.isCallExpression(expression)) {
    const symbol = calledSymbol(expression.expression, checker);
    return Boolean(
      symbol && symbolDelegatesToAdmission(symbol, checker, visited, depth),
    );
  }
  if (ts.isConditionalExpression(expression)) {
    return [expression.whenTrue, expression.whenFalse].every((branch) =>
      delegatesToAdmission(branch, checker, new Set(visited), depth + 1),
    );
  }
  return false;
}

function symbolDelegatesToAdmission(
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
  visited: Set<ts.Symbol>,
  depth: number,
): boolean {
  if (symbol.getName() === "executeAdmittedToolCall") return true;
  if (visited.has(symbol)) return false;
  visited.add(symbol);
  for (const declaration of symbol.declarations ?? []) {
    if (!declaration.getSourceFile().fileName.startsWith(sourceRoot)) continue;
    const implementation = declarationImplementation(declaration);
    if (
      implementation &&
      implementationDelegatesToAdmission(
        implementation,
        checker,
        visited,
        depth + 1,
      )
    ) {
      return true;
    }
  }
  return false;
}

function implementationDelegatesToAdmission(
  implementation: ts.Node,
  checker: ts.TypeChecker,
  visited: Set<ts.Symbol>,
  depth: number,
): boolean {
  if (!ts.isBlock(implementation)) {
    return delegatesToAdmission(implementation, checker, visited, depth);
  }
  let admitted = false;
  visit(implementation, (candidate) => {
    if (admitted || !ts.isCallExpression(candidate)) return;
    const symbol = calledSymbol(candidate.expression, checker);
    if (symbol && symbolDelegatesToAdmission(symbol, checker, visited, depth)) {
      admitted = true;
    }
  });
  return admitted;
}

function referencedSymbol(
  node: ts.Node,
  checker: ts.TypeChecker,
): ts.Symbol | undefined {
  const expression = unwrapExpression(node);
  if (
    !ts.isIdentifier(expression) &&
    !ts.isPropertyAccessExpression(expression)
  ) {
    return undefined;
  }
  const target = ts.isPropertyAccessExpression(expression)
    ? expression.name
    : expression;
  const symbol =
    ts.isIdentifier(expression) &&
    ts.isShorthandPropertyAssignment(expression.parent) &&
    expression.parent.name === expression
      ? checker.getShorthandAssignmentValueSymbol(expression.parent)
      : checker.getSymbolAtLocation(target);
  if (!symbol) return undefined;
  return unalias(symbol, checker);
}

function unwrapExpression(node: ts.Node): ts.Node {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function calledSymbol(
  expression: ts.LeftHandSideExpression,
  checker: ts.TypeChecker,
): ts.Symbol | undefined {
  const target = ts.isPropertyAccessExpression(expression)
    ? expression.name
    : expression;
  const symbol = checker.getSymbolAtLocation(target);
  if (!symbol) return undefined;
  return unalias(symbol, checker);
}

function unalias(symbol: ts.Symbol, checker: ts.TypeChecker): ts.Symbol {
  return symbol.flags & ts.SymbolFlags.Alias
    ? checker.getAliasedSymbol(symbol)
    : symbol;
}

function declarationImplementation(
  declaration: ts.Declaration,
): ts.Node | undefined {
  if (
    ts.isFunctionDeclaration(declaration) ||
    ts.isMethodDeclaration(declaration) ||
    ts.isFunctionExpression(declaration) ||
    ts.isArrowFunction(declaration)
  ) {
    return declaration.body;
  }
  if (
    ts.isVariableDeclaration(declaration) ||
    ts.isPropertyDeclaration(declaration)
  ) {
    return declaration.initializer;
  }
  return undefined;
}

function objectProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | undefined {
  for (const property of object.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      propertyName(property.name) === name
    ) {
      return property.initializer;
    }
    if (
      ts.isShorthandPropertyAssignment(property) &&
      property.name.text === name
    ) {
      return property.name;
    }
  }
  return undefined;
}

function assertNoAgentToolExecuteDestructuring(
  source: ts.SourceFile,
  checker: ts.TypeChecker,
): void {
  visit(source, (node) => {
    if (
      !ts.isVariableDeclaration(node) ||
      !ts.isObjectBindingPattern(node.name) ||
      !node.initializer ||
      !isAgentToolLike(node.initializer, checker)
    ) {
      return;
    }
    const extracted = node.name.elements.some(
      (element) =>
        propertyName(element.propertyName ?? element.name) === "execute",
    );
    if (extracted) {
      const location = source.getLineAndCharacterOfPosition(node.getStart());
      throw new Error(
        `${path.basename(source.fileName)}:${location.line + 1} destructures AgentTool.execute and escapes the admission audit`,
      );
    }
  });
}

function enclosingOwner(node: ts.Node): string {
  for (
    let current: ts.Node | undefined = node.parent;
    current;
    current = current.parent
  ) {
    if (ts.isMethodDeclaration(current)) {
      const method = propertyName(current.name);
      const parent = current.parent;
      return ts.isClassDeclaration(parent) && parent.name
        ? `${parent.name.text}.${method}`
        : method;
    }
    if (ts.isFunctionDeclaration(current) && current.name)
      return current.name.text;
  }
  return "<anonymous>";
}

function propertyName(name: ts.PropertyName | ts.BindingName): string {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name)
  ) {
    return name.text;
  }
  return name.getText();
}

function diagnostic(
  reference: AgentToolExecuteReference,
  message: string,
): string {
  return `${reference.file}:${reference.line} ${message} (${reference.owner})`;
}

function visit(node: ts.Node, callback: (node: ts.Node) => void): void {
  callback(node);
  ts.forEachChild(node, (child) => visit(child, callback));
}
