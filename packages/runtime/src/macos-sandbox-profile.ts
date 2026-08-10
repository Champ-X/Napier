import path from "node:path";

export function processExecRules(
  command: string,
  runtimeReadPaths: readonly string[] = [],
): string[] {
  return [
    `(allow process-exec (literal ${literal(command)}))`,
    ...runtimeReadPaths.map(
      (runtimePath) => `(allow process-exec (subpath ${literal(runtimePath)}))`,
    ),
  ];
}

export function literal(value: string): string {
  return JSON.stringify(path.resolve(value));
}
