# Napier Documentation

Documentation review: **2026-09-07**, against `f5a5937b`.

## Current guides and contracts

| Document                                  | Use it for                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| [Project README](../README.md)            | Product overview, prerequisites, and quick start                                |
| [Local development](local-development.md) | Environment setup, ports, model selection, workspaces, previews, and recovery   |
| [Design system](../DESIGN.md)             | Current Web visual rules and the canonical token JSON consumed by the generator |
| [Architecture](architecture.md)           | Runtime, Ledger, tool, persistence, and recovery contracts                      |
| [Current gaps](next-stage-gap-matrix.md)  | Dated open issues, verification limits, and closure criteria                    |
| [Changelog](../CHANGELOG.md)              | Recent changes and links to earlier history                                     |

The architecture reference is extensive. Start with the local development guide
for operational questions; use the architecture reference for individual flows.
Its latest review updates selected flows and does not revalidate every retained
measurement or historical acceptance claim.

## Learning references

[The architecture learning guide (Chinese)](napier-architecture-learning-guide.zh-CN.md)
walks through execution, persistence, tool governance, recovery, and model
routing, with diagrams and interview exercises. Its source review and test
results are dated 2026-09-07.

[The earlier interview deep dive](napier-interview-deep-dive.zh-CN.md) has its
own source baseline. Both documents are learning references; use the current
guides above for product behavior and setup.

## Historical material

[The archive index](archive/README.md) lists superseded UI proposals, completed
implementation records, the legacy changelog, and dated Harness/Phase 0
snapshots. Their original dates, hashes, and results describe the recorded
baseline. They do not establish the status of the latest source.

## Machine-readable checks and evidence

| Material                                                      | Owner / check                                                                                          |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [Architecture budgets](architecture-budget.json)              | `npm run check:architecture`                                                                           |
| [Web design debt](web-design-debt.json)                       | `npm run check:web-design`                                                                             |
| [Product performance budget](product-performance-budget.json) | `npm run check:product-performance`                                                                    |
| [Long-run scale budget](long-run-scale-budget.json)           | `npm run check:long-run-scale`                                                                         |
| [Retained evidence](artifacts/)                               | The corresponding artifact verifier; see [development checks](local-development.md#development-checks) |

Files in `docs/artifacts/`, benchmark fixtures, and bundled `skills/` can be
inputs to builds or evidence checks. Age alone does not make them disposable.

## Keeping these docs current

- Update the relevant current guide when behavior, configuration, or commands
  change. Link implementation or checks for claims that are easy to invalidate.
- Keep open issues in the current gap matrix. Put completed work in the
  changelog instead of appending another implementation report to the backlog.
- When a proposal is superseded, label it historical, link its replacement,
  and preserve useful context in the archive. Keep a redirect document if
  existing links or evidence inventories use the original path.
- Record the source baseline and verification date for acceptance results.
  A documentation refresh does not refresh release evidence.
- Preserve canonical design JSON, budget files, and retained receipts unless
  their owning workflow is deliberately being updated.
