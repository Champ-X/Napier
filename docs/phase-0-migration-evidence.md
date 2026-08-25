# Phase 0 migration evidence

This document records reproducible, non-release measurements for the Phase 0
cleanup. Canonical release receipts remain under `docs/artifacts` and are not
rewritten until the Phase 0 exit-gate refresh.

## Phase 0-D: non-production workspace extraction

- Production CLI output changed from 181 JavaScript files (about 3.3 MiB) to
  74 JavaScript files (about 1.4 MiB). The only remaining file with
  `benchmark` in its name is the narrow `benchmark-runner` production seam.
- `@napier/benchmark-kit` owns 106 source files and 29 test or fixture files;
  its generated output contains 106 JavaScript files (about 2.2 MiB).
- Runtime owns zero offline `harness-experiment-*` implementations after a
  clean build. `@napier/harness-eval` owns the four implementations and its
  generated output is about 260 KiB.
- Benchmark Kit regression: 19 files and 84 tests passed; 8 live suites and 10
  live tests were skipped by their environment gates.
- Harness Eval regression: 1 file and 10 tests passed, including the complete
  fixed-model matrix of 180 profile-bound Runs.
- Eighteen canonical Benchmark series or campaign entry points passed their
  existing verifier. Goal no-progress (2 trials) and Process recovery (5
  trials) also passed the same verifier APIs used by the release gate.
- Existing Harness release evidence remained promotion-ready with content SHA
  `4c8ff61377da050b4b4884e294daaf48eb760c1a7a1ecf7fdf3c0f4dc819b978`.

## Phase 0-E: Runtime domain exports

- The compatibility root remains at 199 `export *` declarations. Internal
  production root consumers changed from 192 files immediately before this
  migration to 0 files. Tests continue to exercise the compatibility root.
- Eleven explicit domain exports cover the current production consumers:
  `agent`, `browser`, `code`, `core`, `evaluation`, `governance`, `model`,
  `store`, `subagents`, `tools`, and `workflow`.
- Seven fresh Node 24.16.0 processes were sampled per import. Median cold import
  measurements on the development host were:

  | Import | Median time | Median RSS |
  | --- | ---: | ---: |
  | `@napier/runtime` | 541.4 ms | 230.3 MiB |
  | `@napier/runtime/core` | 14.7 ms | 57.6 MiB |
  | `@napier/runtime/code` | 30.5 ms | 69.3 MiB |
  | `@napier/runtime/tools` | 86.3 ms | 77.7 MiB |
  | `@napier/runtime/model` | 129.7 ms | 76.3 MiB |
  | `@napier/runtime/browser` | 147.9 ms | 144.7 MiB |
  | `@napier/runtime/governance` | 157.6 ms | 91.6 MiB |
  | `@napier/runtime/store` | 209.6 ms | 101.1 MiB |
  | `@napier/runtime/subagents` | 120.1 ms | 74.8 MiB |
  | `@napier/runtime/evaluation` | 385.6 ms | 216.6 MiB |
  | `@napier/runtime/workflow` | 408.7 ms | 222.4 MiB |
  | `@napier/runtime/agent` | 513.9 ms | 229.3 MiB |

These timings are directional development-host measurements, not product
performance budgets. The enforced invariant is zero internal production imports
from the Runtime compatibility root.
