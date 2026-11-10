# Changelog

Recent changes are recorded here. Earlier accumulated entries remain in the
[Git history index](docs/archive/README.md), with their original dates and
source baselines preserved.

## Unreleased

### Runtime

- Fold conversation detail projections in one event pass, and load kernel
  projection deltas through typed `listEventsRange` when the ledger supports it.
- Extract plan-field normalize, exact tool-result replay, skill-load predicates,
  and standard-skill snapshot compose helpers to shrink plans/skill hotspots.
- Bind prompt retries to a payload fingerprint, coalesce matching in-flight
  requests within a store, and reject conflicting request IDs. Reuse one
  orchestration projection when producing recovery details. Distinguish local
  model budget rejection from provider failures without exposing diagnostics.
- Persist `run.cancel.requested` before abort for operator stop, parent abort,
  budget timeout, and lease failure; derive orchestration tool ops only from the
  recovery eligibility table. Look up prior prompt admissions with a typed
  `run.started` range instead of scanning the full thread history.
- Write durable `run.prompt.admitted` with `requestId` + fingerprint in the same
  create-leased-run transaction, so retries after a crash before `run.started`
  still resolve to the admitted Run.
- Remove the unused draft `run-admission` contract vocabulary; prompt admission
  stays on `requestId` + fingerprint.
- Align orchestration with Pi Durable patterns without adopting the experimental
  package: projected `RunOrchestrationStateV1` program counter, tool replay
  class map, recovery checkpoint derived from the register, recovery UI
  phase/replay disclosure, tool.operation fence eligibility table, prompt
  `requestId` admission, and cancel-before-abort (`run.cancel.requested`).
  See [Pi Durable alignment](docs/pi-durable-alignment.md).
- Separate semantic progress from execution activity so ongoing inspection,
  implementation and verification receive bounded continuation windows; keep
  plan control tools available during acquisition convergence. Commit: `9b90593c`.
- Compact older complete execution units within the same Run at model request
  boundaries, preserving user messages and binding checkpoints to model context
  receipts. Commit: `02ff34a5`.

### Development and models

- Bound fragmented RPC input copying with geometric buffer growth; preserve
  UTF-8 and per-line limits. Declare the root verification scripts' Hono
  dependencies explicitly.
- Reload development services when the root `.env` is created, edited,
  replaced, or removed, including the Web proxy when the API port changes.
- Allow provider setup to check credentials again and prefer DeepSeek V4 Flash
  when configured, while preserving explicit Agent model choices.
  Commit: `d85a4944`.

### Workbench

- Abort in-flight prompt/resume SSE readers when the operator stops a Run;
  treat client AbortError as a soft disconnect after refreshing thread state.
- Split thinking-activity batch absorption to stay under complexity budget, and
  accept React keyboard events in the shared focus trap.
- Reuse the draft prompt `requestId` until a Run is proven accepted (failures
  keep the identity; success clears it), fingerprint model/capability with the
  draft, localize recovery tool phases, align the evidence overlay with the
  results-rail width, clarify empty results vs file browser copy, and remove
  dead composer-mode / welcome card styles that fought the live chrome.
- Skip full conversation projections on non-surface SSE events; stop writing
  frames after the prompt stream observer disconnects without cancelling the
  Run. Share one focus-trap helper across evidence, settings, developer, and
  model-picker dialogs.
- Release SSE readers and browser subscriptions on cancellation or protocol
  failure; retain workspace pins until asynchronous cleanup finishes. Poll
  active delivery channels independently without overlapping requests.
- Exclude private subagent completion capabilities from public Thread details,
  Bootstrap and SSE snapshots while retaining internal recovery records and
  binding snapshot hashes to the public content.
- Unify workspace and artifact previews for SVG, images, PDF, HTML, Markdown
  and recognized text files. Raise preview and HTTP download limits to 128 MiB,
  bound text rendering, and retain complete downloads. See
  [file previews](docs/file-preview.md) for formats and limits.
- Add the browser-tab favicon and correct logo clipping, panel backgrounds,
  and collapsed workspace navigation. Commit: `9cab7176`.
- Preserve healthy browser sessions after target-action timeouts and keep
  manual recovery linked to the original run context, model, and capabilities.
  Commit: `8242fe4e`.
- Isolate generated deliverables by thread and serve inspected HTML through
  directory-scoped previews that support local assets. Commit: `51a9c642`.
- Render available search evidence, label image-page candidates, and show
  specific read/network failure diagnostics. Commit: `f5a5937b`.

### Documentation and developer checks

- Reconcile Web regression fixtures with Preact, current integrity language,
  recovery checkpoints and workspace API routing. Record the
  [2026-11-07 review](docs/investigations/2026-11-07-code-review.md), measured
  local optimizations, validation results and remaining limits.
- Explicitly declare local faux provider pricing in HTTP test fixtures without
  weakening production budget admission; verify current ledger migrations and
  evaluation settlement ordering.
- Consolidate current architecture, including Run progress and incremental
  context compaction, into a concise source-linked reference.
- Remove superseded design proposals, duplicate historical logs, redirect-only
  pages and obsolete Super Design UI memory; preserve fixed Git references in
  the history index.
- Reconcile layout prose with the existing tokens and controller; centralize
  quantitative source-size rules in the architecture budget.
- Permit responsive CSS and additional viewport coverage while retaining the
  required desktop baselines in `check:desktop-scope`.
- Refresh the documentation index and current gap matrix, including the existing
  public API and release-source failures.

Documentation cleanup: 2026-09-09. This entry does not declare a package release
or refresh historical acceptance evidence.
