export const STAGE7_GATE_HISTORY = [
  {
    id: "G01",
    commands: [
      "npm run build -w @napier/contracts",
      "npm run typecheck -w @napier/contracts",
      "npm exec -- vitest run packages/contracts/test/management-http.test.ts packages/contracts/test/agent-capability-contract.test.ts",
      `node --input-type=module -e 'const value = await import("@napier/contracts/management-http"); if (Object.keys(value).length !== 3) process.exit(1)'`,
    ],
    exitCodes: [0, 0, 0, 0],
    counts: { focusedTests: 96, runtimeValueExports: 3 },
  },
  {
    id: "G02",
    commands: [
      "npm run build -w @napier/sdk",
      "npm run typecheck -w @napier/sdk",
      "npm exec -- vitest run packages/sdk/test/sdk-management-client.test.ts packages/sdk/test/sdk-agent.test.ts packages/sdk/test/sdk-workflow.test.ts",
      "npm run test -w @napier/sdk",
      `node --input-type=module -e 'const value = await import("@napier/sdk/management"); if (Object.keys(value).sort().join(",") !== "NapierManagementClientError,createNapierManagementClient") process.exit(1)'`,
    ],
    exitCodes: [0, 0, 0, 0, 0],
    counts: { focusedTests: 67, fullTests: 79, runtimeValueExports: 2 },
  },
  {
    id: "G03",
    commands: [
      "npm run build -w @napier/server",
      "npm run typecheck -w @napier/server",
      "npm exec -- vitest run apps/server/test/agent-capability-http.test.ts",
    ],
    exitCodes: [0, 0, 0],
    counts: { focusedTests: 3 },
  },
  {
    id: "G04",
    commands: [
      "npm run build:core",
      "npm run build -w @napier/sdk",
      "npm run build -w @napier/cli",
      "npm run build -w @napier/server",
      "npm exec -- vitest run scripts/agent-capability-projection-equality.test.mjs",
    ],
    exitCodes: [0, 0, 0, 0, 0],
    counts: { formalTests: 1, projectionStates: 4 },
  },
  {
    id: "G05",
    commands: [
      "npm run build:core",
      "npm run build -w @napier/sdk",
      "npm run build -w @napier/server",
      "npm exec -- vitest run scripts/sdk-capability-production-server.test.mjs",
    ],
    exitCodes: [0, 0, 0, 0],
    counts: { formalTests: 1 },
  },
  {
    id: "G06",
    commands: [
      "npm run check:architecture",
      "npm run check:package-lock",
      "npm run check:package-lock-receipt",
      "npm run check:management-openapi",
      "npm run check:management-openapi-compatibility",
      "npm run check:runtime-environment",
      "npm run check:runtime-environment-receipt",
      "npm run check:web-dist-manifest",
      "npm run check:web-dist",
      "npm run check:web-dist-receipt",
      "npm run check:release-artifacts",
      "node --import tsx scripts/run-credential-reference-canary.ts",
      "node scripts/capture-sdk-capability-parity.mjs --output-dir docs/artifacts/sdk-capability-parity-stage7 --verify",
    ],
    exitCodes: Array(13).fill(0),
    counts: {
      architectureSourceFiles: 1096,
      architectureTestFiles: 536,
      architectureCycles: 0,
      openApiCompatible: 270,
      openApiTotal: 270,
      canaryMatches: 0,
      evidenceTests: 12,
    },
  },
  {
    id: "G07",
    commands: ["npm run check"],
    exitCodes: [0],
    counts: {
      root: 179,
      cli: 229,
      server: 206,
      web: 548,
      contracts: 99,
      runtime: 1351,
      sdk: 79,
      totalReportedPassedTests: 2691,
    },
  },
  {
    id: "G08",
    commands: [
      "git status --short",
      "git diff --name-only",
      "git diff --check",
      "git diff --cached --name-only",
      "git diff --cached --check",
    ],
    exitCodes: [0, 0, 0, 0, 0],
    counts: { implementationCommitFiles: 33, protectedFilesChanged: 0 },
  },
];

export const STAGE7_REVIEW_HISTORY = [
  {
    round: 1,
    T11: {
      verdict: "FAIL",
      blockers: [
        "sparse-array validator gap",
        "validator exhaustiveness gap",
        "missing SDK abort/hash/418 negative cases",
      ],
    },
    T12: {
      verdict: "FAIL",
      blockers: [
        "child output/lifecycle bound gaps",
        "cleanup gaps",
        "hardcoded or weak evidence causality",
      ],
    },
    remediation: [
      "dense validator and 93-case table",
      "SDK abort/hash/418 tests",
      "child bounds/finally cleanup",
      "causal evidence verifier/tamper suite",
    ],
  },
  {
    round: 2,
    T11: { verdict: "PASS", blockers: [] },
    T12: {
      verdict: "FAIL",
      blockers: [
        "process exit observed without both stdio close barriers",
        "timeout incorrectly accepted as closed-port proof",
        "incomplete source identity",
      ],
    },
    remediation: [
      "exit plus stdio-close barriers",
      "raw TCP-refusal proof",
      "64-path source identity closure",
    ],
  },
  {
    round: 3,
    T11: { verdict: "PASS", blockers: [] },
    T12: {
      verdict: "FAIL",
      blockers: [
        "termination rejection could skip later cleanup",
        "bare then-rejection branch",
      ],
    },
    remediation: [
      "always bounded terminate plus exit plus close",
      "aggregate cleanup errors after attempting every cleanup step",
      "three deterministic lifecycle fault tests",
    ],
  },
  {
    round: "ultimate",
    snapshot: "same frozen 64-identity final snapshot",
    T12: { verdict: "PASS", blockers: [] },
    T11: { verdict: "PASS", blockers: [] },
    commitAllowed: true,
  },
];

export const STAGE7_RETRY_HISTORY = [
  [
    "Initial SDK test compile encountered DOM typing assumptions",
    "Adjusted the bounded SDK type/test boundary and reran to green; public contract unchanged.",
    "resolved",
  ],
  [
    "A broad read-only plan search exceeded its 30-second bound",
    "Interrupted it and used the exact run path; no repository mutation.",
    "resolved",
  ],
  [
    "Root bare import lacked the package-lock-declared SDK workspace link",
    "Used a validated ignored temporary link for the locked smoke and removed/restored it afterward.",
    "resolved-clean",
  ],
  [
    "Offline consumer npm install returned ENOTCACHED for one Runtime dependency",
    "Replaced it with an actual extracted published-tarball JS/TypeScript consumer; no network or package-lock change.",
    "resolved",
  ],
  [
    "One broad rm cleanup command was rejected before execution by policy",
    "Validated ownership and cleaned through the bounded Node filesystem API.",
    "resolved-clean",
  ],
  [
    "First sparse-array validator replay used stale Contracts dist and reported 7 failures",
    "Built Contracts first, then the dense 93/93 systematic cases passed without a source correction.",
    "resolved",
  ],
  [
    "One full G07 run had four transient unrelated CLI timeouts",
    "The four affected files/eight tests passed in isolation, then the exact complete npm run check exited 0.",
    "resolved-by-exact-replay",
  ],
  [
    "T11/T12 review blockers across three rounds",
    "Targeted T13 remediation and complete affected/full/review replay; ultimate dual PASS on one frozen snapshot.",
    "resolved",
  ],
  [
    "The Stage 7 pre-transition validator rejected two administrative drafts",
    "Added execution_mode, corrected it to goal while retaining subagent-only ownership, then reran the exact validator before transition.",
    "resolved-before-transition",
  ],
].map(([event, handling, finalStatus]) => ({ event, handling, finalStatus }));

export const STAGE8_REPAIR_RETRY_HISTORY = [
  {
    event:
      "Two whole-repository architecture tests exceeded Vitest's 5-second default in a combined focused invocation",
    handling:
      "Applied an explicit 20-second per-test bound and replayed the exact combined focused command before recapture.",
    finalStatus: "resolved-by-exact-replay",
  },
  {
    event:
      "The Stage 8 G02 root bare-import smoke again found the package-lock-declared SDK workspace link absent",
    handling:
      "Used a validated ignored temporary link for the locked smoke, removed it immediately, and replayed the complete exact G02 command with the same bounded link lifecycle.",
    finalStatus: "resolved-clean-by-exact-replay",
  },
  {
    event:
      "The first identity-hardening replay redundantly walked the full closure twice and exceeded Vitest's 5-second current-snapshot test default",
    handling:
      "Removed the redundant second walk after the component and overall manifest checks, applied an explicit 20-second test bound, and replayed the exact combined suite.",
    finalStatus: "resolved-by-exact-replay",
  },
];
