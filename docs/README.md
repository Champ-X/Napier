# Napier Documentation

Maintained on **2026-09-09**, against source baseline `02ff34a5`.

## Current guides and contracts

| Document                                                                   | Purpose                                                               |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [Project README](../README.md)                                             | Product overview, prerequisites and quick start                       |
| [Local development](local-development.md)                                  | Setup, ports, models, workspaces, previews and recovery               |
| [Architecture](architecture.md)                                            | Current layers, execution, persistence, tools and recovery boundaries |
| [Design system](../DESIGN.md)                                              | Web visual rules and canonical generated-token JSON                   |
| [Current gaps](next-stage-gap-matrix.md)                                   | Dated check failures, verification limits and closure criteria        |
| [Changelog](../CHANGELOG.md)                                               | Recent implemented changes                                            |
| [Architecture learning guide](napier-architecture-learning-guide.zh-CN.md) | Chinese explanations, diagrams, tradeoffs and interview exercises     |

## Implementation investigations

These dated records explain fixes and their original verification scope. Current
behavior is summarized in Architecture and Local development.

- [Run progress and premature convergence](investigations/2026-09-08-run-progress-interruptions.md)
- [Incremental context compaction within a Run](investigations/2026-09-08-run-context-compaction.md)

## Machine-readable checks and evidence

| Material                                                      | Owning check                                                                                        |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [Architecture budgets](architecture-budget.json)              | `check:architecture`                                                                                |
| [Repository hygiene](repository-hygiene-baseline.json)        | `check:dead-code`, `check:duplicates`, `check:desktop-scope`, `check:public-api`                    |
| [Compatibility ledger](compatibility-ledger.json)             | `check:compatibility-ledger`                                                                        |
| [Web design debt](web-design-debt.json)                       | `check:web-design`                                                                                  |
| [Product performance budget](product-performance-budget.json) | `check:product-performance`                                                                         |
| [Long-run scale budget](long-run-scale-budget.json)           | `check:long-run-scale`                                                                              |
| [Retained evidence](artifacts/)                               | Corresponding artifact verifiers; see [development checks](local-development.md#development-checks) |

These JSON files and retained receipts are inputs to checks. Bundled `skills/`
and benchmark fixtures are product resources. A documentation cleanup does not
change their meaning or refresh their evidence.

## Historical material

The [Git history index](archive/README.md) points to superseded designs, earlier
acceptance narratives and implementation logs at a fixed commit. Historical
bodies and redirect-only documents are omitted from the working tree.

## Maintenance

- Put current behavior in its owning guide and link the implementation.
- Keep quantitative engineering limits in the owning budget/check. Design
  guidance should distinguish static checks from interaction and visual review.
- Track open issues in Current gaps and completed work in the changelog.
- When a document is superseded, update its live links and retain a fixed Git
  reference in the history index rather than a second active specification.
- Record source and verification dates for evidence. Preserve retained receipts
  and historical path inventories unless their owning workflow changes.
