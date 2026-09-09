# Napier Current Gaps

Checked on **2026-09-09**, using source baseline `02ff34a5` with the documentation
and desktop-scope cleanup applied. This file owns current check results and open
verification limits. Historical plans and acceptance narratives are indexed in
[Git history](archive/README.md).

## Open issues and verification limits

| Area                                | Observed status                                                                                                                                                                                                                           | Closure criterion                                                                                                                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture budgets                | `check:architecture` fails with 11 violations in file size, complexity, fan-out and static coupling. Examples include `use-workspace-view-model.ts`, `agent-runtime.ts` and `browser-session.ts`.                                         | Refactor the reported owners and rerun the [gate](../scripts/check-architecture.mjs). The [budgets](architecture-budget.json) remain unchanged.                                    |
| Public API                          | `check:public-api` finds 1,897 Runtime root symbols against the reviewed 1,896-symbol surface, with a symbol digest mismatch.                                                                                                             | Review the added export and its intended entry point; restore compatibility or deliberately revise the public API contract. See the [gate](../scripts/check-public-api.mjs).       |
| Release source identity             | `check:default-product-source` fails because the retained manifest differs from the current source.                                                                                                                                       | Produce source-aligned release evidence through the owning workflow. Use [development commands](local-development.md#development-checks) for local compilation.                    |
| Retained SDK capability snapshot    | Two acceptance assertions in `sdk-capability-parity-evidence.test.mjs` fail because the recorded Stage 8 repair snapshot differs from source. Both failures reproduce in an isolated, unmodified `02ff34a5` checkout at `verifyIdentity`. | Review or recapture source-bound SDK evidence through its owning workflow. Preserve existing receipts and path inventories; a document cleanup cannot establish snapshot equality. |
| Narrow-window visual acceptance     | The obsolete media-query ban is removed. The static desktop check passes, but this cleanup did not run browser verification at the four pressure sizes in [DESIGN.md](../DESIGN.md#9-layout).                                             | Verify actual reflow and interaction at the declared desktop and pressure sizes. Static token/viewport checks do not establish visual acceptance.                                  |
| Full release acceptance             | Not rerun in this cleanup. Historical receipts are bound to their own source identities.                                                                                                                                                  | Run the applicable [release checks](../package.json) on the intended release source.                                                                                               |
| External host and publication proof | Not revalidated here. Local fixtures, signed publication and target-host acceptance use separate evidence.                                                                                                                                | Run the owning workflows and verify source-bound authorities. See [S1 acceptance](architecture.md#s1-completion-requires-two-independent-external-authorities).                    |
| Live model and long-run outcomes    | No new external-model or performance campaign was run.                                                                                                                                                                                    | Execute the relevant model/scale profiles with source, environment, model, credentials class and results recorded.                                                                 |

The architecture, API, release-source and SDK snapshot failures predate this
cleanup. Their budgets and retained receipts were not regenerated. Desktop-scope,
`check:web-design` and `check:compatibility-ledger` pass on the cleaned tree.

## Maintenance

Each issue needs an observed source/check, a date and a closure criterion. Remove
resolved issues and record their implementation in the [changelog](../CHANGELOG.md).
Current behavior belongs in [Architecture](architecture.md) or
[Local development](local-development.md); historical task lists are not an
active roadmap.
