import path from "node:path";
import { canonicalJson, sha256 } from "./ed25519.js";

export interface ToolchainDiagnostic {
  path: string;
  line: number;
  column?: number;
  severity: "error" | "warning";
  code?: string;
  message: string;
}

/** A bounded projection of verifier output. Messages remain untrusted evidence,
 * and malformed locations never become workspace navigation targets. */
export function toolchainDiagnostics(workspaceRoot: string, output: string) {
  const diagnostics: ToolchainDiagnostic[] = [];
  let pythonLocation: { path: string; line: number } | undefined;
  let truncated = false;
  for (const line of output.split("\n")) {
    const python = line.match(/^\s*File "(.+)", line (\d+)/u);
    if (python) {
      const location = workspaceLocation(workspaceRoot, python[1]!);
      pythonLocation = location
        ? { path: location, line: Number(python[2]) }
        : undefined;
      continue;
    }
    const typed = line.match(
      /^(.+?)(?:\((\d+),(\d+)\)|:(\d+)(?::(\d+))?):\s*(error|warning)(?:\s+(\w+))?:\s*(.+)$/u,
    );
    if (typed) {
      const location = workspaceLocation(workspaceRoot, typed[1]!);
      if (location)
        diagnostics.push({
          path: location,
          line: Number(typed[2] ?? typed[4]),
          ...((typed[3] ?? typed[5])
            ? { column: Number(typed[3] ?? typed[5]) }
            : {}),
          severity: typed[6] as "error" | "warning",
          ...(typed[7] ? { code: typed[7] } : {}),
          message: typed[8]!.slice(0, 1000),
        });
    } else if (
      pythonLocation &&
      /^[A-Za-z_][\w.]*(?:Error|Exception):/u.test(line)
    ) {
      diagnostics.push({
        ...pythonLocation,
        severity: "error",
        message: line.slice(0, 1000),
      });
      pythonLocation = undefined;
    }
    if (diagnostics.length >= 64) {
      truncated = true;
      break;
    }
  }
  return {
    diagnostics,
    diagnosticCount: diagnostics.length,
    diagnosticsTruncated: truncated,
    diagnosticSetSha256: sha256(canonicalJson(diagnostics)),
    diagnosticOutputSha256: sha256(output),
  };
}

function workspaceLocation(root: string, candidate: string) {
  if (/[\u0000-\u001f\u007f]/u.test(candidate)) return undefined;
  const relative = path.relative(
    path.resolve(root),
    path.resolve(root, candidate),
  );
  return !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
    ? undefined
    : relative;
}
