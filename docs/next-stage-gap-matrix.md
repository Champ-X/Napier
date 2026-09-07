# Napier Current Gaps

Reviewed on **2026-09-07** against `f5a5937b`. This file tracks open issues and
verification limits. The former 15,151-line implementation log is preserved in
the [archive](archive/implemented-slices-through-2026-09-07.md).

## Open issues and verification limits

| Area                                 | Status at this review                                                                                                                                                                                             | Closure criterion / reference                                                                                                                                                                                                       |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture budgets                 | `npm run check:architecture` fails with 11 violations across file length, complexity, fan-out, and change coupling. Examples include `use-workspace-view-model.ts`, `agent-runtime.ts`, and `browser-session.ts`. | Refactor the reported owners and rerun the [architecture gate](../scripts/check-architecture.mjs). Keep the [budgets](architecture-budget.json) explicit.                                                                           |
| Release source identity              | `npm run check:default-product-source` fails because the retained manifest does not match the current source. Release-gated build and typecheck entry points are therefore not the local development bootstrap.   | Produce and verify source-aligned evidence through the release workflow. See the [manifest verifier](../scripts/release-product-source-manifest.mjs) and [local development commands](local-development.md#development-checks).     |
| Full release acceptance              | Not revalidated in this documentation review. Historical Harness and release receipts refer to their recorded source identities.                                                                                  | Run the applicable release gates on the intended release source; review any failures instead of carrying old pass claims forward. See [package scripts](../package.json).                                                           |
| External host and distribution proof | Not revalidated here. Signed publication, target-host acceptance, and local fixture checks have distinct evidence requirements.                                                                                   | Use the owning external workflows and retain source-bound receipts. See [S1 acceptance boundaries](architecture.md#s1-completion-requires-two-independent-external-authorities).                                                    |
| Live model and long-run outcomes     | No fresh external-model campaign was run for this review. Deterministic tests and historical acceptance counts do not establish current live-provider quality.                                                    | Run the appropriate controlled campaigns with their model, credentials class, source identity, and results recorded. See the [dated Harness acceptance snapshot](agent-harness-optimization-acceptance-matrix-2026-08-23.zh-CN.md). |

The first two rows were checked directly before the documentation edits; their
failures already existed at the review baseline. The remaining rows describe
verification scope, rather than newly observed runtime defects.

This is a focused maintenance review, not a complete reprioritization of the
product. The earlier [P0–P10 priority matrix](archive/implemented-slices-through-2026-09-07.md#priority-matrix)
is retained for context; its individual gaps need a source review before
being promoted into this table.

## Recent behavior now documented

- Development `.env` reload and DeepSeek V4 Flash setup defaults.
- Updated workbench branding, favicon, and collapsed navigation.
- Thread-owned output directories and HTML previews with local assets.
- Healthy browser sessions surviving target timeouts and manual recovery
  retaining the original run configuration.
- Search-result projection and specific network/read diagnostics.

See the [changelog](../CHANGELOG.md) for the implementing commits and the
[local development guide](local-development.md) for operation and troubleshooting.

## Updating this file

Keep entries limited to current gaps. Each entry should name its source or
check, the review baseline, and what would close it. Remove completed issues
from this table and record their delivery in the changelog. Older proposals
and completed slices remain in the [archive](archive/README.md); they are not
an automatically approved roadmap.
