import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import ts from "typescript";

const execFileAsync = promisify(execFile);

export const BASE_COMMIT = "c9f225388cf40766b9002365121242758abf18d8";
export const IMPLEMENTATION_COMMIT = "d81f77b64998fd786aa7a514f53494adb255e1e5";
export const EVIDENCE_SELF_PATH =
  "docs/artifacts/sdk-capability-parity-stage7/evidence.json";
export const REPAIR_CONTENT_EXCLUDED_PATHS = [
  EVIDENCE_SELF_PATH,
  "docs/artifacts/skill-load-fast-core-stage7/evidence.json",
  "docs/artifacts/skill-load-fast-core-stage7/final-check.json",
  "docs/artifacts/skill-load-fast-core-stage7/security-cleanup.json",
];
export const CAPTURE_OUTPUT_PATHS = [
  "docs/artifacts/sdk-capability-parity-stage7/README.md",
  EVIDENCE_SELF_PATH,
  "docs/artifacts/sdk-capability-parity-stage7/four-state-parity.json",
  "docs/artifacts/sdk-capability-parity-stage7/production-server-trace.json",
];
export const PROTECTED_EXCLUDED_PATHS = [
  "goal.md",
  "pre.md",
  "next.md",
  "docs/napier-interview-deep-dive.zh-CN.md",
];
export const PROTECTED_EXCLUDED_PREFIXES = [
  ".claude/",
  "ai-news-weekly/",
  "kakeya/",
];
export const EXECUTION_ROOTS = {
  fourStateParity: [
    "scripts/agent-capability-projection-equality.test.mjs",
    "scripts/agent-capability-parity-harness.mjs",
    "apps/cli/dist/cli.js",
    "apps/server/dist/app.js",
    "packages/sdk/dist/management.js",
  ],
  productionServerTrace: [
    "scripts/sdk-capability-production-server.test.mjs",
    "scripts/sdk-capability-production-server-harness.mjs",
    "scripts/sdk-capability-production-process.mjs",
    "apps/server/dist/index.js",
    "packages/sdk/examples/effective-capabilities.mjs",
    "packages/sdk/dist/management.js",
  ],
};
export const DYNAMIC_INPUTS = {
  fourStateParity: [
    "packages/runtime/test/fixtures/capability-contract-v1/pre-search/manifest.json",
    "packages/runtime/test/fixtures/capability-contract-v1/pre-search/workspace.json",
    "packages/runtime/test/fixtures/capability-contract-v1/pre-search/events/thread_d1872b201aa24d8a84f4.jsonl",
  ],
  productionServerTrace: [],
};
export const EXCLUDED_CATEGORIES = [
  {
    category: "node_builtins_and_third_party_packages",
    reason:
      "Not repository-local files; Node/runtime/package-lock audits bind this dependency boundary.",
  },
  {
    category: "declarations_and_source_maps",
    reason:
      "Type declarations and source maps are not loaded by the executed JS entries.",
  },
  {
    category: "web_static_assets",
    reason:
      "The exercised capability API route does not execute browser bundles or the fallback HTML path.",
  },
  {
    category: "runtime_created_state_temp_and_process_output",
    reason:
      "Ephemeral Store/output data is digest-bound by receipts, sanitized, and removed rather than retained.",
  },
  {
    category: "protected_user_files",
    reason:
      ".env, .claude/, goal.md, pre.md, next.md, the interview document, ai-news-weekly/, and kakeya/ are outside the repair and evidence boundary.",
  },
  {
    category: "evidence_self_content_hash",
    reason:
      "evidence.json cannot contain its own content hash; the external Stage 8 repair commit binds that blob.",
  },
];
export const LINE_BUDGET_FILES = new Set([
  "packages/contracts/src/agent-capability-contract.ts",
  "packages/contracts/src/management-http.ts",
  "packages/sdk/src/management.ts",
  "packages/sdk/src/management-client.ts",
  "packages/sdk/src/management-client-error.ts",
  "packages/sdk/examples/effective-capabilities.mjs",
  "scripts/agent-capability-projection-equality.test.mjs",
  "scripts/agent-capability-parity-harness.mjs",
  "scripts/sdk-capability-production-server.test.mjs",
  "scripts/sdk-capability-production-server-harness.mjs",
  "scripts/sdk-capability-production-process.mjs",
  "scripts/sdk-capability-production-process.test.mjs",
  "scripts/capture-sdk-capability-parity.mjs",
  "scripts/sdk-capability-parity-evidence.mjs",
  "scripts/sdk-capability-parity-evidence.test.mjs",
  "scripts/sdk-capability-parity-identity.mjs",
  "scripts/sdk-capability-parity-receipts.mjs",
]);

export async function captureEvidenceIdentity(options = {}) {
  const overrides = options.contentOverrides ?? new Map();
  const implementation = await immutableImplementationIdentity();
  const repairSnapshot = await currentRepairSnapshot(overrides);
  const executionClosure = await deterministicExecutionClosure(overrides);
  const identity = {
    schemaVersion: 2,
    implementation,
    repairSnapshot,
    executionClosure,
  };
  return { ...identity, manifestSha256: digestJson(identity) };
}

export async function immutableImplementationIdentity() {
  const parent = await gitText(["rev-parse", `${IMPLEMENTATION_COMMIT}^`]);
  if (parent !== BASE_COMMIT) {
    throw new Error(
      "Implementation commit parent does not match the locked base",
    );
  }
  const changedPaths = await gitLines([
    "diff-tree",
    "--no-commit-id",
    "--name-only",
    "-r",
    IMPLEMENTATION_COMMIT,
  ]);
  const files = {};
  for (const file of changedPaths) {
    const [gitBlobSha1, bytes] = await Promise.all([
      gitText(["rev-parse", `${IMPLEMENTATION_COMMIT}:${file}`]),
      gitBytes(["show", `${IMPLEMENTATION_COMMIT}:${file}`]),
    ]);
    files[file] = contentRecord(bytes, { gitBlobSha1 });
  }
  const identity = {
    commit: IMPLEMENTATION_COMMIT,
    parent: BASE_COMMIT,
    changedPaths,
    files,
  };
  return { ...identity, manifestSha256: digestJson(identity) };
}

export async function currentRepairSnapshot(overrides = new Map()) {
  const changedPaths = await currentRepairPaths();
  return repairSnapshotForPaths(changedPaths, overrides);
}

export async function repairSnapshotForPaths(
  changedPaths,
  overrides = new Map(),
) {
  const files = {};
  const deletedPaths = [];
  for (const file of changedPaths) {
    if (REPAIR_CONTENT_EXCLUDED_PATHS.includes(file)) continue;
    const bytes = await currentBytes(file, overrides).catch((error) => {
      if (error?.code === "ENOENT") return undefined;
      throw error;
    });
    if (bytes === undefined) {
      deletedPaths.push(file);
      continue;
    }
    files[file] = contentRecord(bytes);
  }
  const snapshot = {
    relativeTo: IMPLEMENTATION_COMMIT,
    changedPaths,
    files,
    deletedPaths,
    excludedContent: REPAIR_CONTENT_EXCLUDED_PATHS.map((file) => ({
      path: file,
      reason:
        file === EVIDENCE_SELF_PATH
          ? "self_content_hash_bound_by_external_stage8_repair_commit"
          : "self_referential_stage7_final_receipt_closure",
    })),
  };
  return { ...snapshot, manifestSha256: digestJson(snapshot) };
}

export async function currentRepairPaths() {
  const [committed, worktree, untracked] = await Promise.all([
    gitLines(["diff", "--name-only", `${IMPLEMENTATION_COMMIT}..HEAD`]),
    gitLines(["diff", "--name-only", IMPLEMENTATION_COMMIT]),
    gitLines(["ls-files", "--others", "--exclude-standard"]),
  ]);
  return [
    ...new Set([
      ...committed,
      ...worktree,
      ...untracked,
      ...CAPTURE_OUTPUT_PATHS,
      ...REPAIR_CONTENT_EXCLUDED_PATHS,
    ]),
  ]
    .filter((file) => !isProtectedExcludedPath(file))
    .sort();
}

export function isProtectedExcludedPath(file) {
  return (
    PROTECTED_EXCLUDED_PATHS.includes(file) ||
    PROTECTED_EXCLUDED_PREFIXES.some((prefix) => file.startsWith(prefix))
  );
}

export async function deterministicExecutionClosure(overrides = new Map()) {
  const workspaces = await workspacePackages();
  const groups = {};
  for (const name of Object.keys(EXECUTION_ROOTS)) {
    groups[name] = await closureGroup(
      EXECUTION_ROOTS[name],
      DYNAMIC_INPUTS[name],
      workspaces,
      overrides,
    );
  }
  const closure = {
    algorithm: {
      kind: "typescript-ast-static-import-package-export-walker",
      follows: [
        "relative import/export/dynamic-import literals",
        "repository workspace package import exports",
        "explicit dynamic execution inputs",
        "existing source counterparts for executed dist modules",
      ],
    },
    groups,
    excludedCategories: EXCLUDED_CATEGORIES,
  };
  return { ...closure, manifestSha256: digestJson(closure) };
}

async function closureGroup(roots, dynamicInputs, workspaces, overrides) {
  const executionFiles = new Set(dynamicInputs);
  const packageManifests = new Set();
  const externalSpecifiers = new Set();
  const pending = [...roots];
  while (pending.length > 0) {
    const file = pending.pop();
    if (!file || executionFiles.has(file)) continue;
    executionFiles.add(file);
    const source = (await currentBytes(file, overrides)).toString("utf8");
    for (const specifier of moduleSpecifiers(file, source)) {
      const resolved = await resolveSpecifier(
        file,
        specifier,
        workspaces,
        packageManifests,
      );
      if (resolved) pending.push(resolved);
      else externalSpecifiers.add(specifier);
    }
  }
  const sourceCounterparts = new Set();
  for (const file of executionFiles) {
    const counterpart = await sourceCounterpart(file);
    if (counterpart) sourceCounterparts.add(counterpart);
  }
  const allFiles = [
    ...new Set([...executionFiles, ...sourceCounterparts, ...packageManifests]),
  ].sort();
  const files = {};
  for (const file of allFiles) {
    files[file] = contentRecord(await currentBytes(file, overrides));
  }
  const group = {
    roots: [...roots].sort(),
    dynamicInputs: [...dynamicInputs].sort(),
    executionFiles: [...executionFiles].sort(),
    sourceCounterparts: [...sourceCounterparts].sort(),
    packageManifests: [...packageManifests].sort(),
    externalSpecifiers: [...externalSpecifiers].sort(),
    counts: {
      executionFiles: executionFiles.size,
      sourceCounterparts: sourceCounterparts.size,
      packageManifests: packageManifests.size,
      allFiles: allFiles.length,
    },
    executionAreaCounts: areaCounts(executionFiles),
    files,
  };
  return { ...group, manifestSha256: digestJson(group) };
}

function areaCounts(files) {
  const counts = {};
  for (const file of files) {
    const area = executionArea(file);
    counts[area] = (counts[area] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function executionArea(file) {
  for (const prefix of [
    "apps/cli/dist/",
    "apps/server/dist/",
    "packages/contracts/dist/",
    "packages/runtime/dist/",
    "packages/sdk/dist/",
    "scripts/",
  ]) {
    if (file.startsWith(prefix)) return prefix.slice(0, -1);
  }
  if (file.startsWith("packages/runtime/test/fixtures/")) {
    return "packages/runtime/test/fixtures";
  }
  return "other";
}

function moduleSpecifiers(file, source) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS,
  );
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

async function resolveSpecifier(from, specifier, workspaces, manifests) {
  if (specifier.startsWith(".")) {
    return firstExisting(relativeCandidates(from, specifier));
  }
  const workspace = workspaces.find(
    ({ name }) => specifier === name || specifier.startsWith(`${name}/`),
  );
  if (!workspace) return undefined;
  manifests.add(workspace.manifestPath);
  const subpath =
    specifier === workspace.name
      ? "."
      : `.${specifier.slice(workspace.name.length)}`;
  const target = workspace.manifest.exports?.[subpath]?.import;
  if (typeof target !== "string") {
    throw new Error(
      `No import export for repository package specifier ${specifier}`,
    );
  }
  return repoPath(path.resolve(path.dirname(workspace.manifestPath), target));
}

function relativeCandidates(from, specifier) {
  const unresolved = path.resolve(path.dirname(from), specifier);
  const extension = path.extname(unresolved);
  if (extension) return [repoPath(unresolved)];
  return [
    repoPath(`${unresolved}.js`),
    repoPath(`${unresolved}.mjs`),
    repoPath(`${unresolved}.json`),
    repoPath(path.join(unresolved, "index.js")),
  ];
}

async function sourceCounterpart(file) {
  if (!file.includes("/dist/") || !file.endsWith(".js")) return undefined;
  const stem = file.replace("/dist/", "/src/").slice(0, -3);
  return firstExisting([`${stem}.ts`, `${stem}.tsx`]);
}

async function firstExisting(candidates) {
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  return undefined;
}

async function workspacePackages() {
  const output = [];
  for (const root of ["apps", "packages"]) {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = `${root}/${entry.name}/package.json`;
      if (!(await exists(manifestPath))) continue;
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      if (typeof manifest.name === "string") {
        output.push({ name: manifest.name, manifestPath, manifest });
      }
    }
  }
  return output.sort((left, right) => right.name.length - left.name.length);
}

async function currentBytes(file, overrides) {
  const override = overrides.get(file);
  return override === undefined
    ? readFile(path.resolve(file))
    : Buffer.from(override, "utf8");
}

function contentRecord(bytes, additional = {}) {
  return {
    ...additional,
    sha256: sha256Bytes(bytes),
    lines: lineCount(bytes.toString("utf8")),
  };
}

function digestJson(value) {
  return sha256Bytes(Buffer.from(JSON.stringify(value), "utf8"));
}

function lineCount(value) {
  if (value.length === 0) return 0;
  return value.split("\n").length - (value.endsWith("\n") ? 1 : 0);
}

function repoPath(value) {
  return path.relative(process.cwd(), value).split(path.sep).join("/");
}

async function exists(file) {
  return access(path.resolve(file)).then(
    () => true,
    () => false,
  );
}

async function gitLines(arguments_) {
  const text = await gitText(arguments_);
  return text ? text.split("\n").filter(Boolean).sort() : [];
}

async function gitText(arguments_) {
  return (await gitBytes(arguments_)).toString("utf8").trim();
}

async function gitBytes(arguments_) {
  const { stdout } = await execFileAsync("git", arguments_, {
    cwd: process.cwd(),
    env: commandEnvironment(),
    encoding: "buffer",
    timeout: 10_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

function commandEnvironment() {
  return {
    LANG: "C",
    PATH: process.env.PATH ?? "",
    TMPDIR: process.env.TMPDIR ?? "/tmp",
    TZ: "UTC",
  };
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}
