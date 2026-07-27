# Changelog

All notable changes to Napier are recorded here.

## [0.1.0] - 2026-07-25

### Added

- Durable Operator Decision gates. Live Agents can now invoke the terminating
  `request_operator_decision` tool as the only call in a turn, durably commit a
  bounded 2-4 option question, complete the origin Run into a waiting Thread,
  and stop without another provider request. Answer and Continue are separate
  append-only transitions, so an answered gate survives process failure before
  explicit continuation creates a child Run with the origin model, Agent
  revision, and `parentRunId`. Store authorization prevents ordinary Prompts
  from bypassing an open gate; pending/answered gates can also be cancelled,
  and terminal Run outcomes settle unpreserved requests. Strict no-store
  list/answer/cancel management APIs, hash-verified continuation SSE, a lazy
  accessible Paper Ledger decision docket, portable Run-ID remapping, and
  metadata-only OTLP privacy coverage complete the runtime-to-Workbench flow.
  The generated management OpenAPI and additive compatibility baseline now
  contain 228 operations.
- Persistent Workflow Blueprint Library. Verified
  `napier.execution-plan-blueprint` artifacts can now be saved as
  `ExecutionPlanBlueprintRecord` entries, listed with no-store active/archived
  count and set-hash headers, archived/restored, and replayed into a new Plan
  through `POST /api/threads/:threadId/plans/from-blueprint-record`. Store,
  server, and Web API coverage prove deduplication by blueprint SHA-256,
  hash-only Ledger events, and normal Plan creation gates for saved records.
  The Plan Workbench now exposes a Template shelf for saving the current
  verified blueprint, browsing active/archived records, archive/restore
  actions, source qualification, and create-from-template replay inside the
  lazy Plan chunk. `GET /api/plan-blueprints/:recordId/qualification` now
  verifies saved-template usability without mutation, distinguishing
  `qualified`, `archived`, `source_missing`, `source_drift`, and `invalid`
  states while exposing expected/actual source hashes only. Creating a Plan
  from a saved template now fails closed unless the final Store-side
  qualification is `qualified`, and the `plan.created` event carries only the
  qualification status plus report/diagnostic hashes. `POST
/api/threads/:threadId/plans/from-blueprint-record/preview` now returns a
  no-store Plan projection plus qualification state before mutation, and the
  Workbench Template shelf exposes that preview receipt beside Qualify/Create.
  Preview responses include a stable `previewSha256` over Plan shape and
  hash-only evidence; create requests may provide `expectedPreviewSha256`, and
  stale or mismatched previews fail closed with the current preview report. The
  Store now commits create-from-template Plan state and the `plan.created`
  replay evidence event in a single Ledger revision, preventing Plan/history
  divergence after partial failures. Successful create responses now mirror the
  atomic replay event id, seq, and SHA-256 headers for immediate machine
  verification, and `POST
  /api/plan-blueprints/:recordId/replays/events/verify` can validate that
  single event anchor without returning the raw Ledger event payload. The
  Workbench Template shelf now consumes those headers after template replay,
  verifies the single event anchor, and renders the verification status in the
  creation receipt along with the verifier receipt hash. Missing, malformed, or
  unverifiable replay event anchors are now rendered as invalid receipt
  diagnostics rather than silently appearing as ordinary Plan creation. The
  qualification/preview/create/history/history-verification receipt projections
  are now isolated in pure Web ViewModel mappings with contract tests for
  source-drift, ready/blocked preview, valid, missing-anchor, verifier-failure,
  latest-replay, empty-history, and observed-count paths.
  The Web API client now preserves hash-verified non-error JSON payloads on
  `NapierApiError`, so the Workbench can render a returned 409 preview report
  instead of collapsing it into a generic error string.
  `GET /api/plan-blueprints/:recordId/replays` now derives a hash-only
  `napier.execution-plan-blueprint-replay-history` receipt from Ledger
  `plan.created` events, including replay/thread/plan counts, event-set hash,
  objective hash, qualification hashes, and latest preview hash. The Template
  shelf exposes this as an on-demand History action without storing additional
  replay state. `POST /api/plan-blueprints/:recordId/replays/verify` now
  verifies uploaded replay-history receipts against the current Ledger-derived
  projection with declared/recomputed/observed hashes and low-cardinality
  diagnostics. The Template shelf now downloads replay-history JSON artifacts
  and can upload them back for no-store verification.
- Blueprint replay outcome artifacts. `GET
/api/plan-blueprints/:recordId/replays/outcomes` now joins immutable
  `plan.created` replay anchors to current durable Plan projections and emits a
  stable `napier.execution-plan-blueprint-replay-outcomes` receipt with
  active/completed/blocked/cancelled/invalid counts, completion basis points,
  per-replay outcome hashes, replay-history hash, and outcome-set hash. The
  report binds hashed step/artifact evidence projections while omitting
  objective, path, blocker, and evidence prose. `POST
/api/plan-blueprints/:recordId/replays/outcomes/verify` performs bounded
  strict no-store verification against the current Ledger and Plan state, so
  stale delivery receipts fail closed after an outcome changes. The Template
  shelf now exports and uploads outcome JSON separately from replay history,
  with pure ViewModel receipts and contract tests for latest-outcome and
  observed-count behavior.
- Blueprint outcome baselines. `POST
/api/plan-blueprints/:recordId/replays/outcomes/baselines` now promotes the
  current verified outcomes receipt into an append-only hash-only baseline with
  replay/outcome hashes, aggregate counts, a policy threshold set, and an
  explicit supersession chain. Promotion fails closed unless the uploaded
  artifact matches the current Store projection and satisfies the policy,
  which defaults to 100% completed, zero blocked, and zero invalid replays.
  `GET /api/plan-blueprints/:recordId/replays/outcomes/qualification` now
  recomputes current outcomes against the latest baseline and returns
  `qualified`, `missing_baseline`, or `policy_failed` with current/baseline
  hashes and low-cardinality diagnostics. The Template shelf can promote and
  qualify outcome baselines, and Web ViewModel tests cover both receipt types.
- Adaptive blueprint template selection. `POST
/api/threads/:threadId/plan-blueprints/selection` now recomputes source
  qualification, outcome-baseline qualification, and target-Thread preview
  readiness for every saved template, then returns a no-store
  `napier.execution-plan-blueprint-selection` receipt. The deterministic rank
  favors completion basis points, replay evidence volume, baseline recency, and
  record freshness, while exposing only record IDs, preview hashes,
  baseline/outcome hashes, low-cardinality diagnostics, and a selection-set
  SHA-256. The Template shelf adds a Select best action with a pure ViewModel
  receipt so blocked or unqualified libraries fail visibly.
- Blueprint outcome model review. `POST
/api/plan-blueprints/:recordId/replays/outcomes/review` now returns a no-store
  `napier.execution-plan-blueprint-outcome-review` artifact that scores current
  replay outcomes against reusable delivery criteria with an explicit evaluator
  model. The review binds verdict, score, risk, criteria scores,
  input/prompt/response/schema hashes, current outcome hashes, and baseline
  hashes while keeping objective text, artifact paths, blockers, and evidence
  prose out of the artifact. `napier/demo` fails closed as inconclusive, and
  the Template shelf exposes Review outcomes through a ViewModel receipt.
- Reviewed blueprint outcome baseline promotion. Outcome baseline promotion can
  now carry a current outcome review artifact plus an optional score/risk gate.
  The Store rehashes the review, verifies it against current replay outcomes,
  source qualification, and outcome qualification status, and only appends the
  superseding baseline when verdict, score, and risk pass. Server responses
  mirror review gate, review hashes, verdict, score, risk, and model headers,
  while the Template shelf exposes a separate Promote reviewed action and
  receipt so model-reviewed baselines remain distinguishable from plain policy
  baselines.
- Blueprint portfolio calibration. `GET
/api/plan-blueprints/portfolio/calibration` now returns a no-store
  `napier.execution-plan-blueprint-portfolio-calibration` receipt over the
  whole Template shelf. The Store groups saved templates by hashed workflow
  shape, aggregates qualification status, reviewed baseline coverage, replay
  outcomes, and top record IDs, and exposes only family hashes, counts, and a
  portfolio-set SHA-256. Server headers mirror the calibration counters, and
  the Template shelf adds a Calibrate action backed by pure ViewModel receipt
  tests.
- Portfolio-aware blueprint selection. Adaptive template selection now binds
  the current portfolio-set SHA-256 into
  `napier.execution-plan-blueprint-selection`, projects each candidate's
  workflow-family hash and family aggregate evidence, and uses family
  completion, reviewed-baseline coverage, and outcome-qualified family count as
  deterministic tie-breakers before replay volume and record freshness. Server
  headers and Template shelf receipts expose the selected family hash without
  leaking objective, step, artifact, blocker, or evidence prose.
- Blueprint recommendation policy templates. `POST
/api/threads/:threadId/plan-blueprints/selection` now accepts `policyTemplate`
  as `balanced`, `delivery_first`, or `portfolio_first`. Selection keeps source
  qualification as a fail-closed gate, then hashes the chosen policy and uses
  its weights for outcome completion, portfolio-family completion,
  reviewed-baseline coverage, and replay-evidence recommendation scores.
  Server headers and Template shelf receipts now expose the policy template,
  policy SHA-256, candidate recommendation score, and selected recommendation
  score without copying objective prose into the artifact.
- Blueprint recommendation policy backtesting. `GET
/api/plan-blueprints/portfolio/recommendation-policy-backtest` now compares
  `balanced`, `delivery_first`, and `portfolio_first` against the current
  Template shelf's historical replay outcomes without target-Thread preview or
  Ledger mutation. The no-store receipt binds the policy-set SHA-256,
  portfolio-set SHA-256, divergent selection count, per-policy selected
  record/family IDs, average recommendation score, and hash-only candidate
  evidence. Server headers mirror the receipt hashes and counts, and the
  Template shelf adds a Backtest policies action with a pure ViewModel receipt.
- Per-family blueprint recommendation policy overrides. `POST
/api/plan-blueprints/portfolio/recommendation-policy-overrides` now persists a
  hash-only override for a workflow-family SHA-256 and policy template, guarded
  by optional `expectedPortfolioSetSha256` CAS so stale backtest/calibration
  evidence fails closed with 409. Default selection applies policy precedence
  as explicit request, family override, then `balanced`, and selection
  receipts/headers now expose override-set SHA-256, selected policy source, and
  family override hash. The Template shelf can apply the top backtested policy
  as a family override through a pure ViewModel receipt.
- Blueprint recommendation policy override drift review. `GET
/api/plan-blueprints/portfolio/recommendation-policy-overrides/drift-review`
  now emits a no-store hash-only receipt that compares each persisted family
  override against current portfolio/backtest evidence. It returns keep/retire
  recommendations, aligned/retire/missing-family counts, review-set SHA-256,
  override/best policy hashes, selected record IDs, and low-cardinality
  diagnostics. Server headers mirror the drift counters and hashes, and the
  Template shelf adds a Review override drift action backed by pure ViewModel
  receipt tests.
- Blueprint recommendation policy override retirement. `POST
/api/plan-blueprints/portfolio/recommendation-policy-overrides/retire` now
  removes a stale family override only when the request supplies matching
  family, override, override-set, drift review-set, and portfolio-set SHA-256
  evidence from a fresh drift review. Aligned overrides and stale evidence fail
  closed with 409. The retirement receipt exposes the retired override/policy
  hashes, drift review-set SHA-256, and remaining override-set SHA-256, and the
  Template shelf can retire the highlighted drifted override from the
  ViewModel-projected receipt.
- Blueprint recommendation policy override retirement history. `GET
/api/plan-blueprints/portfolio/recommendation-policy-overrides/retirements`
  now returns an append-only no-store history receipt for removed family
  overrides. The receipt binds current override-set SHA-256, retirement-set
  SHA-256, latest retirement timestamp, and the persisted retirement receipts,
  so retired defaults remain auditable after the live override set changes.
  Server headers mirror the history counters/hashes, and the Template shelf can
  audit retirement history through a pure ViewModel receipt.
- Blueprint recommendation policy override retirement history verification.
  `POST
/api/plan-blueprints/portfolio/recommendation-policy-overrides/retirements/verify`
  now accepts an exported retirement history and returns a no-store verification
  receipt with declared/recomputed/observed content, portfolio-set,
  current-override-set, and retirement-set hashes. The runtime validates every
  embedded retirement receipt, distinguishes tampered files from stale durable
  state, mirrors verification evidence in response headers, and the Template
  shelf now downloads retirement history JSON and uploads it back through a pure
  ViewModel receipt.
- Cross-Ledger policy override retirement proof bundles. `POST
/api/plan-blueprints/portfolio/recommendation-policy-overrides/retirements/proof-bundle/verify`
  now accepts multiple exported retirement histories, validates each
  self-contained, and returns a no-store proof-bundle receipt with
  aligned/divergent/invalid status, valid/invalid counts, distinct
  portfolio/current-override/retirement-set counts, and bundle-set hashes.
  Response headers mirror the proof counters and hashes, while the Template
  shelf can upload multiple retirement history JSON files at once through a
  pure ViewModel receipt.
- Signed policy override retirement proof bundles. `POST
/api/plan-blueprints/portfolio/recommendation-policy-overrides/retirements/proof-bundle/sign`
  now recomputes uploaded retirement histories, refuses invalid bundles, and
  signs aligned or divergent proof-bundle receipts with existing Ed25519
  receipt trust anchors. The trusted envelope binds the proof-bundle content
  hash, receipt artifact hash, signer key id, and signature statement hash,
  appends a hash-only `receipt.signed` Ledger event, and can be verified through
  the generic receipt trust endpoint. The Template shelf adds **Sign bundle**,
  refreshes signing-capable anchors before signing, downloads the signed JSON
  envelope, and renders envelope/source proof hashes through a pure ViewModel
  receipt.
- Public receipt trust anchor directories. `GET
/api/receipt-trust/anchors/directory` now exports a stable
  `napier.receipt-trust-anchor-directory` containing public verifier labels,
  key IDs, SPKI public keys, trust/revocation state, per-anchor hashes, and an
  anchor-set SHA-256 without signing-source locators. `POST
  /api/receipt-trust/anchors/directory/verify` validates uploaded directories
  without Ledger mutation, and `POST /api/receipt-trust/verify` can verify a
  signed envelope against an uploaded directory instead of local workspace
  anchors. The Receipt trust desk can download and verify directory JSON files
  for cross-Ledger signed policy-retirement proof audits.
- Receipt trust anchor directory freshness and rotation policies. Directory
  verification requests can now include `maxAgeMs`,
  `expectedAnchorSetSha256`, `minimumTrustedCount`, and
  `requiredTrustedKeyIds`; policy violations make the uploaded directory
  verification `invalid` with policy hash, directory age, and bounded
  diagnostics. `POST /api/receipt-trust/verify` accepts the same
  `directoryPolicy` and fails closed before signature trust evaluation when an
  external directory is stale, from an unexpected anchor set, under-populated,
  or missing a required trusted signer. Server headers and the Receipt trust
  desk expose directory verification hash, policy hash, and directory age so
  cross-Ledger signed policy-retirement proof audits can bind trust freshness
  to receipt validation.
- Allowlisted hosted receipt trust directory discovery. `POST
/api/receipt-trust/anchors/directory/discover` now retrieves a public
  directory from an exact HTTPS origin configured through
  `NAPIER_RECEIPT_TRUST_DIRECTORY_ORIGINS`, with public-endpoint validation,
  manual redirects, an eight-second timeout, a 2 MiB streaming limit, strict
  JSON media type, and exact HTTP 200 requirement. The no-store
  `napier.receipt-trust-anchor-directory-discovery` receipt binds URL/origin
  hashes, raw response hash/size, policy verification, and the accepted public
  directory without returning the URL or mutating Ledger state. The Receipt
  trust desk can discover a directory with a 24-hour/minimum-trusted-key policy
  plus optional anchor-set pin and use it for subsequent signed JSON
  verification.
- Durable receipt trust directory subscriptions. Hosted verifier sources can
  now be promoted only after a valid bounded discovery, with their raw URL
  retained exclusively in the local workspace snapshot and URL/origin hashes
  used in public projections and Ledger events. Each subscription carries a
  policy hash, refresh interval, next refresh time, revision, and last-good
  discovery. Expiring Store claims drive production background refreshes;
  immediate refresh and pause/resume APIs use revision CAS. Valid rotations
  atomically promote the new directory, while invalid, failed, concurrent, or
  stale refreshes preserve the prior last-good trust set and record bounded
  rejection/failure evidence. Subscriptions now retain a bounded hash-only
  transparency chain of accepted observations; returning to a previously seen
  non-current directory is rejected as `rollback_rejected` without replacing
  last-good trust. Server headers, Ledger events, and the Receipt trust desk
  expose transparency entry count and tail hash for audit binding.
- Receipt trust directory subscription quorum receipts. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum` now evaluates
  active last-good subscriptions without mutation. The default 2-of-2 policy
  now also requires two distinct source origins, groups sources by anchor-set
  SHA-256, and returns a stable no-store receipt with
  source/candidate/agreement counts, agreement weight, distinct-origin count,
  policy hash, diagnostics, selected directory hash, selected anchor-set hash,
  metadata publisher count/set hash, and hash-only source evidence. Policies
  can now pin required source-origin hashes, assign bounded per-origin weights,
  require metadata publisher counts, and pin required metadata publisher hashes
  from signed directory metadata envelopes supplied with the no-store quorum
  request. The Receipt trust desk exposes a quorum action and renders agreement
  status next to durable directory subscriptions.
- Receipt trust directory quorum promotion receipts. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion` now
  evaluates the same no-store quorum request, requires an `agreed` result, and
  returns a self-contained promotion receipt containing the quorum, selected
  subscription-set hash, selected anchor-set/directory hashes, and selected
  signed metadata envelopes whose hashes match trusted source metadata evidence.
- Signed receipt trust directory quorum promotion baselines. `GET/POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines`
  now promotes an agreed verifier-key quorum into append-only local trust state
  by signing the recomputed promotion receipt as
  `receipt_trust_anchor_directory_quorum_promotion`. Baseline idempotency binds
  the selected verifier set and signer key rather than one-time metadata
  verification timestamps, while headers expose baseline, envelope, receipt,
  selected set, and signer hashes. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/verify`
  verifies uploaded baselines against local or uploaded public trust
  directories and returns a no-store verification receipt with status,
  diagnostics, selected-set hashes, and trust-directory evidence. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/import`
  now CAS-imports verified archives into local append-only trust state when
  `expectedCurrentBaselineSha256` matches the current latest baseline hash.
  Import requests can include an optional `importPolicy`; accepted imports now
  return a hash-bound `policyReview`, expose policy/review SHA-256 headers, and
  reject activation before persistence when local freshness, quorum strength,
  source-origin, publisher, signer, anchor-set, or directory pins are not
  satisfied. The Web Receipt Trust Desk now includes a baseline activation
  workbench that lists the latest signed quorum baseline, compares selected
  source origins against active last-good directory subscriptions, verifies the
  baseline against local or active external trust anchors, and imports uploaded
  archives with a derived policy while surfacing verification and policy-review
  hashes. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-decision`
  now signs the recomputed baseline verification, policy review, and
  source-alignment projection as a
  `receipt_trust_anchor_directory_quorum_activation_decision` trusted receipt,
  returning a portable approved/rejected envelope and hash-only Ledger event.
  Signed activation decisions are now persisted as bounded local records keyed
  by envelope hash. `GET
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-decisions`
  exports a stable activation-decision history with aggregate set hashes and
  signed records, while `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-decisions/verify`
  verifies uploaded histories against the current local projection with
  `valid`, `divergent`, and `invalid` diagnostics. The Receipt Trust Desk can
  export the durable history and verify uploaded history JSON from the
  activation workbench. `GET
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection`
  now exports the active verifier-set selection state, and `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/apply`
  CAS-applies an approved activation-decision record into that active
  selection. The selection binds the public selected directory, baseline hash,
  decision record hash, and previous selection hash without importing private
  signing material; stale selection hashes fail closed and duplicate applies
  are idempotent. The Web workbench adds **Apply activation** and renders the
  active verifier selection receipt. `POST /api/receipt-trust/verify` now uses
  the active selection directory as the default verifier-key source when the
  request does not upload an explicit directory, while uploaded directories
  retain precedence. Verification responses and headers disclose whether the
  trust source was `active_selection` or `uploaded`, plus active selection
  ID/hash evidence when applicable; the Web verifier receipt renders that
  source beside the signature result.
- Active verifier selection drift audits and rotation reviews. `GET
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/drift-audit`
  now compares the applied verifier-set selection with the current subscription
  quorum without mutation, returning `missing_selection`, `aligned`,
  `directory_drift`, `anchor_set_drift`, or `quorum_unavailable` plus
  hash-only selection/quorum evidence. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-review`
  preflights a candidate activation-decision record against the current
  selection CAS hash and live source alignment, returning `eligible`,
  `already_active`, `blocked`, `stale_selection`, or `missing_decision` before
  the existing apply endpoint can mutate trust state. The Receipt Trust Desk
  adds **Audit drift** and **Review rotation** receipts, with runtime, server,
  and Web API coverage for the new projections.
- Active verifier selection transparency checkpoints. `GET
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint`
  now exports the applied selection rotation chain as a compact hash-only
  checkpoint over selection entries, activation-decision hashes, baseline
  hashes, selected directory/anchor-set hashes, policy-review hashes, and
  source-alignment hashes. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/verify`
  validates uploaded checkpoints no-store against current local selection
  history and returns `valid`, `divergent`, or `invalid`. The Store now keeps a
  bounded append-only applied-selection history, migrates legacy current
  selections into the history tail, and the Receipt Trust Desk adds
  **Export checkpoint** and **Verify checkpoint** receipts.
- Signed active-selection checkpoint envelopes. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/sign`
  now signs the current checkpoint as
  `receipt_trust_anchor_directory_quorum_activation_selection_checkpoint`
  using existing Ed25519 receipt trust anchors. The generic receipt verifier
  accepts the new receipt kind, including active-selection-backed verifier-key
  lookup, and the Receipt Trust Desk adds **Sign checkpoint** with signed JSON
  download.
- Hosted signed active-selection checkpoint discovery. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/discover`
  now fetches a signed checkpoint envelope through the allowlisted hosted JSON
  boundary, verifies the trusted receipt with uploaded, active-selection, or
  local verifier keys, compares the checkpoint to local selection history, and
  enforces freshness, required signer, expected checkpoint/selection-set/tail
  hashes, minimum selection count, and rollback rejection gates. The response
  is no-store and hash-bound, exposing source URL/origin, response, policy,
  envelope, checkpoint, current tail, and diagnostics as evidence hashes. The
  Receipt Trust Desk adds **Discover checkpoint** with URL and checkpoint-hash
  pin inputs, and Web ViewModel/API tests cover the generated policy and
  wrapper.
- Durable checkpoint registry subscriptions. `GET/POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/subscriptions`
  now manages hosted signed-checkpoint registries with active/paused status,
  revision CAS, scheduled refresh leases, last-good preservation, and bounded
  transparency history over discovery, envelope, checkpoint, selection-count,
  selection-set, and chain-tail hashes. Manual refresh and pause/resume endpoints
  mirror the directory subscription model; invalid or failed observations cannot
  replace last-good checkpoint evidence. The Receipt Trust Desk can subscribe,
  refresh, and pause checkpoint registries, and Server/Web tests cover the new
  wrappers and receipts.
- Checkpoint registry quorum receipts. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/subscriptions/quorum`
  now evaluates durable signed-checkpoint registries without mutation,
  requiring configurable source, agreement, distinct-origin, freshness,
  checkpoint, selection-set, chain-tail, source-origin, and signer-key policy
  gates. The receipt groups eligible last-good observations by checkpoint
  SHA-256 and returns `agreed`, `insufficient_sources`, `split`,
  `policy_failed`, or `stale` with hash-only source/candidate/agreement
  evidence and headers. The Receipt Trust Desk adds **Evaluate checkpoint
  quorum**, and Server/Web tests cover the agreed independent-origin path.
- Signed checkpoint-registry quorum baselines. `GET/POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/subscriptions/quorum/baselines`
  now archives an `agreed` signed-checkpoint registry quorum as a trusted
  receipt envelope with kind
  `receipt_trust_anchor_directory_quorum_activation_selection_checkpoint_registry_quorum`.
  Baselines bind selected checkpoint, selection-set, chain-tail,
  subscription-set, source-origin-set, signer-set, signer key, and
  supersession evidence; duplicate promotion is idempotent by selected registry
  evidence plus signer. The Receipt Trust Desk adds **Promote checkpoint
  quorum**, downloads the signed baseline JSON, and tests verify generic
  receipt-trust validation.
- Checkpoint-registry quorum baseline verification and import. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/subscriptions/quorum/baselines/verify`
  now performs no-store verification of uploaded signed checkpoint-registry
  quorum baselines against local anchors or an uploaded trust directory,
  returning baseline/signature/integrity diagnostics plus baseline, envelope,
  quorum, selected checkpoint, source-set, signer-set, and trust-directory
  hashes. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/subscriptions/quorum/baselines/import`
  CAS-imports trusted baselines with `expectedCurrentBaselineSha256`, appends
  a local supersession record and hash-only Ledger event, and returns
  idempotent already-archived results for duplicate imports. The Web API and
  Receipt Trust Desk can verify/import checkpoint quorum baseline archives.
- Rotation review checkpoint-registry gates. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-review`
  now accepts an optional `checkpointRegistryQuorumPolicy`. When supplied, the
  no-store rotation review embeds the current checkpoint-registry quorum
  receipt and blocks with `checkpoint_registry_quorum_not_agreed` unless the
  quorum status is `agreed`. The Receipt Trust Desk automatically applies the
  default checkpoint-registry quorum gate to Review rotation whenever checkpoint
  subscriptions exist, making split or stale external checkpoint registries
  visible before verifier-set rotation.
- Automated verifier rotation proposal receipts. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal`
  now recomputes the ordinary rotation review, consumes the latest or requested
  checkpoint-registry quorum baseline as a fail-closed prerequisite, and
  compares the baseline's checkpoint, selection-set, and chain-tail hashes with
  the current activation-selection transparency checkpoint. The no-store
  receipt returns `proposed` only when review, baseline precondition, and
  checkpoint transparency alignment all pass; otherwise it reports
  `missing_checkpoint_registry_baseline`, `already_active`,
  `stale_selection`, or `blocked` diagnostics without mutating state. The Web
  API and Receipt Trust Desk expose **Propose rotation** beside Review
  rotation.
- Signed verifier rotation proposal receipts and apply gate. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/sign`
  now signs only freshly recomputed `proposed` rotation proposals as trusted
  receipt envelopes. Active verifier-set replacement through the activation
  selection apply endpoint now requires that signed fresh proposal envelope,
  verifies it against the current active selection directory, recomputes the
  proposal, and rejects stale envelopes with mismatch diagnostics before any
  trusted state mutation. The Receipt Trust Desk adds **Sign proposal** and
  carries the signed envelope into Apply activation.
- No-store signed rotation proposal preflight. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/preflight`
  now runs the same signed-proposal gate without mutating state, returning a
  hash-bound `accepted`, `rejected`, or `not_required` receipt with proposal,
  envelope, trusted-verification, CAS, and checkpoint-baseline evidence. The
  Receipt Trust Desk exposes **Preflight proposal** before Apply activation.
- Hosted signed rotation proposal discovery. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/discover`
  now fetches a hosted trusted receipt envelope from the allowlisted discovery
  boundary, runs signed proposal preflight, and applies operator policy pins
  for envelope/proposal hashes, activation decision, expected selection CAS,
  signer key IDs, and maximum envelope age. The no-store discovery receipt
  returns hash-only source and policy evidence plus diagnostics without
  mirroring raw hosted URLs.
- Durable hosted rotation proposal subscriptions. `GET/POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/subscriptions`
  now persists allowlisted hosted signed-proposal sources with raw URLs kept
  local-only, hash-only public evidence, policy-bound last-good discovery, and
  bounded transparency entries over discovery, envelope, proposal, and
  preflight hashes. Manual and leased background refreshes share the same
  claim/settle path and return `accepted`, `unchanged`, `rollback_rejected`,
  `rejected`, or `failed`, preserving last-good across invalid or failed
  hosted observations; status updates can pause or resume a subscription
  without exposing the source URL.
- Signed rotation proposal subscription approval receipts. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/subscriptions/:subscriptionId/approval/sign`
  now signs the subscription's current last-good proposal as a trusted receipt
  only after revision/content pins, optional discovery/envelope/proposal pins,
  and the live signed-proposal preflight all pass. The approval receipt binds
  subscription, source, policy, discovery, envelope, proposal, current preflight,
  activation-decision, proposal signer, and optional expiry evidence without
  exposing the hosted source URL.
- Approval-gated rotation proposal apply. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/subscriptions/:subscriptionId/approval/apply`
  now verifies the signed approval envelope with the current active verifier
  directory, rechecks subscription CAS and last-good proposal binding, reruns
  the current proposal preflight, and only then applies the activation decision.
  Successful apply events carry approval/proposal/subscription/current-preflight
  hashes only.
- Unattended approval-gated rotation apply scheduling. Approval signing accepts
  `queueForApply` plus optional `applyAfter`, stores the approval envelope as
  local-only pending state on the rotation proposal subscription, keeps the
  public subscription hash stable, and lets the leased background worker claim
  due approvals, rerun the approval apply gate, CAS-apply the activation
  decision, and settle success or failure with hash-only events.
- Multi-approval verifier rotation policy review and apply. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/subscriptions/:subscriptionId/approval/policy-review`
  evaluates approval envelopes against `minimumDistinctSignerCount` and
  optional `requiredSignerKeyIds`, collapsing duplicate signer approvals while
  requiring every accepted approval to pass the existing apply gate. `POST
/approval/policy-apply` requires an accepted review before CAS-applying the
  rotation and returns a policy-bound apply receipt.
- Signed multi-approval policy baselines. `GET/POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/approval-policy-baselines`
  now exposes append-only signed policy baselines for verifier rotation
  approvals. Promotion signs an accepted policy review as a trusted receipt;
  verification supports local or uploaded trust directories, and CAS import
  preserves the archived envelope while assigning local baseline identity and
  supersession.
- Policy-baseline-gated unattended verifier rotation scheduling. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/subscriptions/:subscriptionId/approval/policy-apply/queue`
  now queues policy apply only when the current multi-approval review is
  accepted and the supplied signed approval policy baseline matches the review
  binding hashes. The leased worker claims due queues, reruns the policy review
  and baseline gate, executes the existing CAS apply, and settles success or
  failure as local-only pending state plus hash-only Ledger events.
- Generated management-plane OpenAPI route artifact. `npm run
write:management-openapi` now scans `apps/server/src/app.ts`, emits
  `docs/artifacts/management-openapi-0.1.0.json` with all `/api` routes,
  OpenAPI path parameters, source SHA-256, and route-set SHA-256 evidence.
  `npm run check:management-openapi` fails on route drift. `GET /api/health`
  now has the first promoted endpoint response schema, binding its `200`
  response to `#/components/schemas/HealthResponse`. `GET
  /api/receipt-trust/anchors` and `POST /api/receipt-trust/anchors` now
  promote `ReceiptTrustAnchorList`, `CreateReceiptTrustAnchorRequest`, and
  `ReceiptTrustAnchor` schemas, including a required JSON request body and the
  real `201` create response for trust-anchor enrollment clients. `GET
  /api/receipt-trust/anchors/directory` and `POST
  /api/receipt-trust/anchors/:anchorId/revoke` now promote the public anchor
  directory, revoke request, and returned anchor schemas so external verifier
  management clients can depend on the full anchor lifecycle contract. `POST
  /api/receipt-trust/anchors/directory/verify` and `POST
  /api/receipt-trust/anchors/directory/discover` now promote no-store
  directory verification and hosted discovery schemas, including verification
  policy, hash diagnostics, and discovery response evidence. `POST
  /api/receipt-trust/anchors/directory/signed-metadata` and `POST
  /api/receipt-trust/anchors/directory/metadata/verify` now promote
  publisher metadata signing envelopes and metadata verification receipts,
  including signature evidence, trust-directory policy, and binding
  diagnostics. `POST /api/receipt-trust/verify` now promotes a generic trusted
  receipt verification request and response schema, covering uploaded
  directories or the active verifier selection as trust sources. `GET/POST
  /api/receipt-trust/anchors/directory/subscriptions` plus subscription update
  and refresh routes now promote durable trust-directory subscription schemas,
  including public transparency history, refresh receipts, CAS revision
  requests, and hash-only source URL evidence. `POST
  /api/receipt-trust/anchors/directory/subscriptions/quorum` now promotes the
  multi-source quorum request and response schemas, including source weights,
  metadata publisher evidence, selected directory hashes, and candidate set
  diagnostics.
- Management OpenAPI compatibility fixture. `npm run
write:management-openapi-compatibility` now emits
  `docs/artifacts/management-openapi-compatibility-0.1.0.json`, a published
  operation baseline that allows additive routes but rejects removed operations
  or drift in operation ids, tags, path parameters, request-body presence,
  promoted schema refs, and response status sets. The top-level release
  artifact receipt now binds both OpenAPI artifacts alongside runtime,
  package-lock, Web dist, and manifest evidence.
- Hashline-style workspace edits. `read_file` now returns bounded line
  SHA-256 anchors for the selected range, and `apply_patch hashline_replace`
  can replace anchored lines without retyping old text while still requiring
  the complete-file SHA-256, per-target write lock, atomic commit,
  protected-path checks, and fail-closed duplicate-anchor diagnostics.
- Deterministic Model Advisor notices. Assistant turns now run a hash-only
  stream-lint pass before the user-visible message is recorded. The first
  advisory rules flag unverified tests/build/checks-passed claims and
  destructive command references, recording rule IDs, severity, counts, text
  SHA-256, diagnostic-set SHA-256, and tool-evidence counts without copying the
  matched text or mutating the assistant response.
- Configurable Model Advisor policy. Agent profiles now carry a revisioned
  `modelAdvisor` policy with observe/enforce/off mode and an enabled rule set.
  The Context Workbench exposes the controls, server profile updates validate
  them, and schema-4 Run configuration fingerprints bind the effective advisor
  policy alongside the Skill catalog hash for replay drift detection. Enforce
  mode records `model.advisor.blocked` and fails the Run before
  `message.assistant` when blocker-level diagnostics match.
- Bounded Model Advisor correction. Enforce policies can allow zero to three
  tool-free rewrite attempts before failing closed. Each attempt records
  hash-only request and outcome receipts that bind the predecessor response,
  diagnostic set, corrective prompt, and corrected response without persisting
  the corrective prompt. Enforce-mode candidate text, reasoning, and deltas are
  reduced to hash-and-size debug evidence and withheld from the Web stream until
  a candidate passes. Schema-5 Run fingerprints bind the correction budget
  while schema-4 Runs retain a zero-attempt interpretation.
- Post-apply replay receipts for unattended verifier rotation. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/subscriptions/:subscriptionId/approval/apply/replay`
  now emits a no-mutate receipt that verifies the approval against the
  approval-bound previous verifier selection, compares current active selection
  to the approved activation decision, and returns `aligned`, `divergent`, or
  `invalid` with hash-only diagnostics.
- Publisher-signed receipt trust directory metadata. `POST
/api/receipt-trust/anchors/directory/signed-metadata` now emits a
  `receipt_trust_anchor_directory_metadata` trusted receipt over the current
  public anchor directory, binding publisher, directory hash, anchor-set hash,
  public key counts, optional source hashes, and optional expiry. `POST
/api/receipt-trust/anchors/directory/metadata/verify` verifies both the
  Ed25519 envelope and the supplied directory binding with either local anchors
  or an uploaded trust directory. The Receipt trust desk can export signed
  metadata and verify uploaded metadata against the active external directory.
- Reusable workflow blueprints for Durable Plans. `GET
/api/threads/:threadId/plans/:planId/blueprint` distills a Plan archive into
  `napier.execution-plan-blueprint`: objective, step DAG, artifact
  declarations, source Plan revision, archive hash, and event-stream hash,
  without runtime evidence prose or status. `POST
/api/threads/:threadId/plans/blueprints/verify` performs no-store stable-hash
  validation, and `POST /api/threads/:threadId/plans/from-blueprint` creates a
  new Plan through the normal creation gate while recording only
  blueprint/source hashes. The Plan Workbench now exposes export, upload
  verification, and create-from-verified-blueprint actions in its lazy chunk.
- Durable Plan archive export and no-store verification. `GET
/api/threads/:threadId/plans/:planId/archive` now emits a
  `napier.execution-plan-archive` artifact containing the current
  `ExecutionPlan`, ordered plan-scoped Ledger events, a stable content hash,
  and event-stream hash. `POST
/api/threads/:threadId/plans/:planId/archive/verify` recomputes the hashes,
  validates plan/event ownership, binds the archive to the URL Thread and Plan,
  and returns low-cardinality diagnostics without mutating state. The Plan
  Workbench exposes export and upload verification actions inside its lazy
  chunk, with runtime/server/Web tests and no-store headers covering archive
  hash, event count, step/artifact/replan counts, and path mismatch.
- Trace Workbench is now a lazy chunk. Event rendering, delegation cards,
  OpenTelemetry export, and archived trace verification load only when the
  Trace tab is opened, keeping OTLP archive tooling outside the main Workbench
  entry while preserving the same default tab behavior.
- Plan Workbench is now a lazy chunk. Plan DAG rendering, artifact manifests,
  replan draft review, and replan draft application load only when the Plan tab
  is opened, removing Plan-specific API clients and review state from the main
  Workbench entry while preserving the same replan CAS behavior.
- Run Lab is now a lazy Workbench chunk. The main Workbench entry keeps only the
  tab shell, while replay export/verification, fixture transfer, comparison,
  evaluation, and nested Evaluation Suite controls load on demand. This restores
  main-entry budget headroom for future Agent inspection features without
  changing Lab behavior.
- No-store OpenTelemetry trace artifact verification through
  `POST /api/threads/:threadId/trace/otlp/verify`. The endpoint strictly parses
  a single exported artifact, replays the existing OTLP envelope/span graph,
  redaction, count, source-hash, and stable content-hash validation without
  mutating Ledger state, binds the artifact to the URL thread, and returns
  `valid` / `invalid` plus low-cardinality diagnostics. Runtime, server, and
  Web coverage now proves valid archive verification, tamper rejection,
  path-mismatch rejection, and no-store response headers that mirror trace
  hash, event-stream hash, span/event counts, and diagnostic hashes.
- Trace Workbench archived-artifact verification. The OpenTelemetry export card
  now accepts a local OTLP artifact JSON file, submits it through the same
  hash-verified no-store management client, and renders a compact valid/invalid
  receipt with diagnostics, trace hash, and span/event counts without mutating
  the active Thread.
- Self-contained Run replay snapshot verification through
  `POST /api/threads/:threadId/runs/:runId/replay/verify`. Per-Run replay
  snapshots now carry Subagent task evidence and a stable `contentSha256`
  independent of `generatedAt`; the verifier recomputes event-stream hashes,
  metrics, assistant-output hashes, configuration binding, stable content hash,
  and URL thread/run identity without mutating state. Server/Web wrappers and
  tests cover valid snapshots, tamper rejection, and path mismatches, while
  replay headers now mirror snapshot hash and subagent counts.
- Run Lab archived replay verification. The Lab now accepts a local per-Run
  replay JSON snapshot, binds it to the active Thread plus embedded Run ID via
  the no-store verifier, and renders a valid/invalid receipt with diagnostics,
  snapshot hash, event count, and Subagent count without mutating state.
- No-store `POST /api/threads/import/verify` preflight for portable Thread
  replay bundles. The endpoint reuses the same fail-closed bundle validator as
  import, returns `valid` / `invalid` plus low-cardinality diagnostics without
  mutating state, and mirrors content hash, verification status, diagnostic
  hash, bundle hash, event-stream hash, and resource counts in headers. Web now
  exposes a typed `verifyThreadReplayBundle` wrapper, and runtime/server
  coverage proves valid fixture verification, tamper rejection, and no-mutation
  behavior before import.
- Run Lab now surfaces the portable Thread fixture preflight as a separate
  upload action beside import. Operators can verify archived fixture JSON,
  inspect valid/invalid diagnostics and resource counts, and keep the active
  Thread unchanged until they explicitly choose the mutating import path.
- TypeScript monorepo with contracts, runtime, server, and web workspaces.
- Pi-powered provider registry and live agent-loop adapter.
- Deterministic zero-key demo model using the production event path.
- Authoritative SQLite WAL with `synchronous=FULL`, atomic workspace/event
  commits, thread-sequence primary keys, and revision compare-and-swap for
  bounded multi-instance retries.
- SQLite ledger schema version 2 with an online migration-history table,
  v1-to-v2 backfill under `BEGIN IMMEDIATE`, health reporting, and
  post-migration `quick_check` evidence. Health responses now expose no-store
  response hashes plus service/status, Ledger schema version, quick-check,
  migration-count, migration-list hash, latest migration headers, public Node
  runtime version/platform/arch, and SQLite/OpenSSL/libuv/V8 component evidence
  for CI readiness probes.
- The health readiness body is now a shared `HealthResponse` contract consumed
  by both the server and Web API wrapper, with Web contract coverage for the
  typed `/api/health` JSON path.
- Thrown management API errors, explicit management JSON errors, and unknown
  `/api/*` routes now return no-store, hash-bound JSON projections, with
  headers for response content SHA-256, HTTP status, stable error code, and
  error-message SHA-256 without copying the error text into headers.
- Server contract tests now statically guard no-store response header helpers
  and JSON route returns so helper regressions cannot omit
  `X-Napier-Content-SHA256` unnoticed.
- Web API clients now verify failed JSON response body and error-message hashes
  before wrapping trusted failures as `NapierApiError`, preserving the server
  message plus status, code, response hash, and message hash for operator
  diagnostics and future UI branching. Common UI error banners now use a shared
  formatter for those diagnostic handles.
- JSON API wrappers now share one request helper so future management-plane
  header parsing changes stay centralized; successful JSON responses with
  `X-Napier-Content-SHA256` are verified before parsing, accepting exact
  response-body hashes or independently recomputed canonical stable projections
  for `contentSha256` / `reviewSha256`. Stable projection coverage now includes
  generated/exported timestamp exclusion, execution ID/runtime timestamp
  exclusion, review receipts, Casebook artifacts, and Extension deployment
  previews that summarize nested previews by SHA-256. SSE Run requests keep
  their separate streaming path. Web contract tests cover success JSON hash
  verification, recomputed stable artifact/review/execution/preview digests,
  success/error hash drift rejection, header-backed `NapierApiError`, and
  missing-metadata fallback behavior.
- Web JSON responses now require `X-Napier-Content-SHA256`; missing success or
  error body evidence fails closed instead of returning or displaying
  unverified text. Error responses without code/message metadata still keep a
  status-based fallback once the body hash is verified.
- Web static boundary tests now also require every production `requestJson`
  call site to target `/api/*`, preventing the hash-verified management client
  from being reused for static files or external URLs.
- Management JSON responses now mirror the hash semantic as
  `X-Napier-Content-SHA256-Mode: body|stable`, emitted through a centralized
  server helper. Static server tests reject direct content-hash header writes,
  and the Web verifier treats explicit mode values as constraints instead of
  accepting an ambiguous body/stable fallback. Unsupported explicit mode values
  now fail closed before response or error text is trusted.
- Body-mode Web JSON success and error responses are now hash-verified before
  `JSON.parse`. Malformed JSON with a mismatched body hash reports
  `NapierContentHashError`; malformed JSON after a verified body hash reports a
  structured parse error carrying the verified digest.
- Streaming Run clients now dispatch SSE frames through a shared record parser,
  flush a final record even when the server closes without a trailing blank
  line, report malformed successful frames as `NapierStreamFrameParseError`
  with path, frame SHA-256, and line count, reject JSON-valid frames that
  violate the `StreamFrame` union with `NapierStreamFrameContractError`, and let
  consumer callback failures propagate without being mislabeled as parse
  failures. Runtime `error` frames remain valid protocol frames for UI
  surfacing, but now carry a stable public message, `run_failed` code, and
  SHA-256 diagnostic handle instead of streaming raw exception text. Prompt and
  resume SSE responses now expose thread/run intent headers plus stream error
  code, diagnostic type, and public error-message hash before the body starts.
  The Web streaming client verifies those headers before reading the SSE body
  and rejects streams that close without a terminal `done` or `error` frame, or
  that emit additional semantic frames after a terminal frame. If an SSE
  `event:` name is present, Web also requires it to match the JSON `frame.type`;
  event frames must carry an SSE `id:` equal to `frame.event.seq`, and non-event
  frames must not carry `id:`. Stream-local event sequence values must also
  strictly increase so duplicate or reordered events fail before UI dispatch,
  and event frames now require a positive safe-integer sequence plus known
  `EventCategory` and `EventVisibility` values.
  Event and snapshot frames must bind back to the declared stream thread, and
  event/`done` frames must keep one Run identity so cross-thread or mixed-run
  frames fail before UI callbacks. `StreamFrame.done` now carries only terminal
  Run statuses (`completed`, `failed`, `cancelled`, or `interrupted`), and the
  server writes done frames through the same terminal-status guard. Event frames
  now carry `eventSha256`; the server computes it from `RunEvent`, and the Web
  client recomputes it before dispatch so event-body drift fails closed with
  hash-only diagnostics. Snapshot frames now require `thread.id`, known
  `thread.status`, a matching `thread.eventCount`, and same-thread valid
  RunEvent records with contiguous increasing sequence values before replacing
  the Workbench projection. They also require the Workbench-owned `agent`,
  `contextCheckpointCalibration`, and top-level collection projections to
  prevent partial snapshots from reaching renderers, with `agent.id`,
  `thread.agentId`, `thread.runIds`, `currentRunId`, and `runs[]` checked for
  one-thread/one-agent consistency. Snapshot frames now carry `detailSha256`,
  and the Web client recomputes the hash before replacing the Workbench
  projection. Successful `done` streams must now carry `threadId`,
  `snapshotSha256`, `eventCount`, and `eventStreamSha256`, include that final
  snapshot before the terminal frame, and bind the same thread, Run ID, terminal
  status, snapshot hash, event count, and ordered event-stream hash; done-only,
  wrong-thread, missing-run, status-drift, done/snapshot hash-drift,
  event-count drift, or event-stream hash-drift streams fail closed. Final
  snapshots must also include every already-streamed event with the same
  `eventSha256`, so stale snapshots, truncated event lists, or event body drift
  fail before UI callbacks. Runtime `error` frames now carry `threadId`, so
  wrong-thread error frames fail closed while still exposing only the public
  message, `run_failed` code, and diagnostic SHA-256 instead of raw exceptions.
  Web and server contract coverage now includes frame parsing, hash-only
  bad-frame diagnostics, invalid-frame contract rejection, runtime error frame
  dispatch with diagnostic hashes, prompt/resume intent and error-protocol
  headers, SSE event/frame type matching, SSE id/sequence matching, monotonic
  event-sequence rejection, stream thread/run identity rejection, invalid event
  field rejection, event hash drift rejection, invalid or incomplete snapshot
  rejection, missing-final-snapshot rejection, non-terminal `done` rejection,
  snapshot/done run-status mismatch rejection, done/snapshot hash mismatch
  rejection, done/event-count mismatch rejection, snapshot hash drift rejection,
  snapshot/streamed-event mismatch rejection, missing terminal-frame rejection,
  terminal ordering rejection, hash-bound pre-stream `NapierApiError` wrapping,
  pre-stream hash drift/missing-hash rejection, and missing readable bodies.
- Web contract tests now statically guard direct `fetch` usage so future UI
  code cannot bypass the hash-verified JSON helper or the dedicated SSE client.
- Web contract tests are now included in the Web TypeScript project, so the
  production Web build typechecks API-client and streaming-client contracts
  before emitting the bundle.
- `npm run check:runtime-environment` now audits the current Node runtime before
  build output is trusted, verifying `package.json#engines.node`, observed
  platform/arch, and required SQLite/OpenSSL/libuv/V8 component versions.
- `npm run write:runtime-environment-receipt` now writes a
  `napier.runtime-environment-audit` artifact, while
  `npm run check:runtime-environment-receipt` /
  `npm run verify:runtime-environment-receipt` verify the stored runtime
  evidence against the current Node process and `package.json` hash.
- `npm run check:package-lock` now audits `package-lock.json` before build
  output is trusted, verifying lockfile version, root/workspace package
  metadata, workspace links, dependency-map mirroring, and external package
  integrity coverage. Its root-level contract tests cover dependency drift,
  missing integrity, missing workspace links, and JSON receipt output.
- `npm run write:package-lock-receipt` now writes a
  `napier.package-lock-audit` artifact, while
  `npm run check:package-lock-receipt` / `npm run verify:package-lock-receipt`
  verify the stored receipt against the current package metadata and lockfile
  hashes before build output is trusted.
- `npm run check` now runs a Web dist release gate after the production build:
  it recomputes every `apps/web/dist` SHA-256 against
  `docs/artifacts/web-dist-0.1.0.sha256`, rejects missing or extra files, and
  enforces the 150 KiB main-entry budget from the actual module script in
  `index.html`.
- The Web dist release gate now exports a reusable auditor with root-level
  Vitest contract coverage for passing manifests, hash drift, unlisted files,
  malformed manifests, unsafe entry paths, and entry-budget regressions. Root
  `npm test` runs those checks before workspace suites.
- `npm run check:web-dist -- --json` now emits a `napier.web-dist-audit`
  receipt containing relative paths, file counts, main-entry budget evidence,
  manifest SHA-256, canonical dist-content SHA-256, and errors for CI capture.
- `npm run update:web-dist-manifest` now regenerates
  `docs/artifacts/web-dist-0.1.0.sha256` from the current Web dist using the
  same canonical ordering and SHA-256 formatter as the release gate, while
  `npm run check:web-dist-manifest` fails CI when the stored manifest is stale.
- `npm run write:web-dist-receipt` now writes a passing
  `napier.web-dist-audit` receipt artifact for CI capture. Custom receipt
  targets must stay repo-relative, and failed audits remove any stale target
  instead of leaving an old success receipt in place.
- `npm run check:web-dist-receipt` / `npm run verify:web-dist-receipt` now
  validate the stored Web dist audit receipt against the current build,
  including schema, manifest hash, canonical dist-content hash, entry budget,
  and exact receipt projection drift.
- `npm run write:release-artifacts` now writes a top-level
  `napier.release-artifacts-audit` receipt that binds the package-lock receipt,
  runtime-environment receipt, Web dist receipt, and Web dist manifest by
  SHA-256. `npm run check:release-artifacts` /
  `npm run verify:release-artifacts` verify the aggregate receipt against the
  current component evidence, with root-level contract tests for aggregate
  drift and component receipt drift.
- Root formatting now ignores generated Web dist files and SHA manifest
  artifacts so audit manifests remain verifier inputs rather than Prettier
  parse targets.
- Automatic legacy `workspace.json`/JSONL migration with contiguous-sequence
  validation, recoverable event-first crash repair, fail-closed missing
  evidence detection, and non-authoritative compatibility projections.
- Atomic first-run onboarding bootstrap and lease-aware restart reconciliation
  that leaves active work owned by another local runtime instance untouched.
- Thread creation, branching, durable goals, run cancellation, and SSE streams.
- Bounded strict JSON parsing for Thread creation, Branch creation, Goal
  updates, Resume, Prompt, and Trace export requests before runtime state
  mutation, evidence copying, trace projection, or model execution.
- Bounded strict JSON parsing for schedule and inbound-channel administration,
  rejecting unknown fields, malformed trigger wrappers, invalid status values,
  and out-of-range retry policies before any automation state mutation.
- Bounded strict JSON parsing for Memory proposal/review and credential
  reference administration, rejecting unknown wrappers, malformed resource IDs,
  invalid enums, overlarge Memory content, invalid review intervals, and
  malformed credential sources before persistence.
- Bounded strict JSON parsing for Run Evaluation, adjudication, reviewer
  ballot, consensus preview/resolve, and Evaluation Suite create/update APIs,
  rejecting unknown wrappers, malformed run IDs, invalid verdicts, malformed
  rubrics, and out-of-range quality gates before model judging or gate state
  mutation.
- Bounded strict JSON parsing for Evaluation Casebook create/update, curation,
  removal, and qualification APIs, rejecting unknown wrappers, malformed
  source references, invalid evaluator models, malformed gates, and oversized
  bodies before revision changes, qualification execution, or Ledger events.
- Bounded strict JSON parsing for Agent profile update and rollback APIs,
  rejecting unknown wrappers, malformed audit threads, unsupported tool/skill
  sets, invalid thinking/tool policies, and out-of-range Run/Subagent/automatic
  recovery limits before revision state mutation.
- Bounded strict JSON parsing for MCP Extension proposal, review, enablement,
  connect/disconnect, and tool review APIs, rejecting unknown wrappers,
  malformed transports, invalid capabilities/effects, malformed routing hints,
  and invalid Agent/Thread IDs before Extension trust or tool exposure changes.
- Bounded strict JSON parsing for Receipt Trust anchor administration, signed
  gate/qualification receipt export, and qualification baseline promotion
  requests before trust-anchor mutation, signing, or baseline state changes.
- Bounded strict JSON parsing for Extension publisher anchors, Skill/Prompt/
  Inspector/Extension package signing, lockfile export, rollout publishing and
  application, and signed channel-index export before package governance state
  changes or signature generation.
- Directory artifact verification in the internal Plan tool surface, computing
  a canonical manifest digest from sorted relative paths, nested directory
  markers, file byte counts, and per-file SHA-256 values under the existing
  workspace and 32 MiB verification bounds.
- Public Plan artifact updates can request server-side `observeWorkspace`
  verification for files or directories; observed verification computes the
  digest from local workspace bytes, rejects simultaneous self-reported
  `sha256`/`sizeBytes`, and preserves the normal Ledger event path.
- Strict goal evaluation with bounded auto-continuation and repeated-evidence
  breakers.
- Revisioned parent-Run limits for model turns, total tokens, provider-reported
  cost, and wall time, snapshotted with the Agent revision before execution.
- Shared Run accounting across the primary Pi loop, Context compactor, Goal
  evaluator, Memory extractor, and Subagents, including delta-safe delegated
  usage.
- Model-specific token accounting with raw provider `usage` preserved beside
  hash-bound `usageAccounting` projections; Run token budgets now use
  calibrated `budgetTokens` for model responses and fall back to raw totals for
  legacy or delegated usage.
- Provider price-table cost calibration in the same `usageAccounting`
  projection, including reported cost, estimated cost, `budgetCostUsd`,
  price-table ID/SHA-256, and fail-closed budget checks for zero-cost provider
  reports on known providers.
- Refreshable usage price-table catalogs with per-table hashes, catalog
  verification for tampering, duplicate providers, and missing required
  providers, no-store REST download/verify APIs, and Context Inspector catalog
  evidence.
- Usage price-table catalog and verifier responses now expose no-store content
  hashes, provider/table counts, provider-set hashes, diagnostic counts,
  diagnostic-set hashes, verifier status, and catalog hashes for polling both
  valid and invalid uploads.
- Context checkpoint calibration reports derived from Ledger events, with
  verified/drifted/malformed sample classification, coverage and compression
  metrics, fallback omission counts, no-store REST access, and
  content, event-stream, checkpoint-status count, failure-count,
  coverage/compression, fallback-omission, and latest-checkpoint headers.
- Deterministic replacement-plan draft evaluation for replan recommendations,
  including strategy-aligned checks, replacement-work counts, score/risk
  projection, and `evaluationSha256` evidence in both Workbench and Agent tool
  output.
- Fail-closed `run.budget.exhausted` evidence with first-reason semantics,
  pre-tool side-effect blocking, distinct operator cancellation, and optional
  Memory extraction skip when no budget remains.
- Workspace-confined file inspection tools with canonical realpath checks,
  external-symlink rejection, complete-file SHA-256 metadata, UTF-8 validation,
  and fail-closed policy checks.
- Hash-preconditioned `apply_patch` for bounded UTF-8 file creation and unique
  exact replacement, with protected-path rejection, multi-runtime PID locks,
  stale-owner recovery, pre-commit CAS rechecks, fsync, and atomic link/rename.
- Structured patch evidence in Trace containing path, operation, byte counts,
  edit count, and before/after SHA-256 without enabling general shell, deletion,
  parent-directory creation, or Subagent writes.
- Sandboxed `verify_workspace` dispatch for fixed local TypeScript, Vitest, and
  Prettier CLIs with canonical workspace targets, no package scripts or shell,
  read-only workspace access, disabled networking, and a fixed environment.
- Structured verification evidence for passed, failed, timed-out, and
  output-capped outcomes, including exit state, duration, truncation flags,
  bounded stdout/stderr, and independent output SHA-256 digests.
- Bundled standard Agent Skills for research, software delivery, and artifacts.
- Ed25519 signed Skill package baselines that freeze hash-only Skill catalog
  evidence, including requested/loaded/missing names, diagnostics hash, file
  paths, sizes, and SHA-256 values without copying Skill instructions, plus
  workspace qualification that detects catalog drift or missing Skills.
- Auditable memory proposals, approval workflow, agent scoping, and
  prompt-injection-resistant context injection.
- Automatic live-model memory extraction that never bypasses human review.
- Correction-aware live-model extraction over a 40-fact/6,000-character
  reviewed replacement inventory, with inventory SHA-256 evidence,
  pending-target exclusion, strict target allowlisting, and inherited
  scope/Agent semantics.
- Fail-closed rejection of malformed, unavailable, duplicate, or repeated
  `supersedesMemoryId` / `consolidatesMemoryIds` targets before extracted
  proposals are persisted.
- Manual and model-assisted 2–8 source Memory consolidation with canonical
  source IDs, correction/consolidation mutual exclusion, same-scope/Agent
  enforcement, and overlapping pending-replacement rejection.
- Atomic consolidation approval that activates one synthesized fact and
  archives every validated source with a shared reverse link in one SQLite
  workspace commit; rejected or pending proposals leave all sources unchanged.
- Configurable 1–3,650 day Memory review intervals with 90-day defaults,
  pre-prompt automatic expiry, explicit stale/refresh transitions, and
  `memory.stale` Ledger evidence.
- Per-Run deduplicated Memory usage evidence with durable use count, last-used
  time, and last-used Run ID.
- Append-only Memory correction proposals with scope-preserving
  `supersedesMemoryId`, competing-correction rejection, atomic replacement
  approval, bidirectional links, and non-restorable superseded history.
- Memory list, proposal, and review responses now expose no-store hashes,
  per-status counts, lifecycle status/revision headers, review metadata, use
  counts, Agent scope, and supersession/consolidation headers.
- Paper Ledger Memory governance UI with review-period controls, correction
  tickets, 2–8 source selection, consolidation tickets, review queue,
  lifecycle actions, usage registers, and multi-source provenance.
- Isolated researcher, reviewer, and general subagents with read-only tools,
  bounded concurrency, total/turn/time budgets, cancellation, and durable task
  records.
- Typed Subagent outcomes. New delegated completions must return one strict JSON
  object with a summary, categorized severity-ranked items,
  workspace-relative line evidence, and explicit unknowns. The runtime records
  accepted/rejected outcome evidence and binds successful results to the task,
  role, model, immutable role instructions, prompt, raw result, canonical item
  set, and stable receipt SHA-256. Replay verification checks that binding, and
  fixture import remaps task IDs while recomputing receipt hashes.
- Workspace-grounded Subagent evidence. Outcome file and line references now
  resolve through the same realpath, UTF-8, and size boundary as `read_file`.
  Successful receipts bind each observed file SHA-256, exact range SHA-256,
  byte size, line count, and aggregate evidence-set SHA-256; missing,
  out-of-range, escaping, oversized, or non-text references fail the
  delegation. Grounded receipts use schema 2 while existing schema-1 receipts
  remain valid and importable.
- No-store Subagent evidence drift verification. `POST
/api/threads/:threadId/subagents/:taskId/outcome/verify` revalidates a stored
  schema-2 receipt against current workspace bytes and reports aligned,
  divergent, missing, or legacy-unavailable references with expected/observed
  file and range hashes plus hash-only diagnostics. The task-scoped operation
  appends no Ledger event, returns a stable content SHA-256 with count/status
  headers, and has a promoted OpenAPI response schema with no request body.
  Trace delegation cards load the verifier on demand and render current,
  drifted, missing, and legacy states without exposing file content or raw
  filesystem errors.
- Bounded typed Subagent outcome repair. A structurally malformed final
  candidate can consume one remaining Subagent turn in a dedicated zero-tool
  Agent that only rewrites the strict outcome JSON. Hash-only request and
  outcome receipts bind task/role/model, original task and immutable
  instruction hashes, predecessor/result hashes, diagnostic, repair
  prompt/instruction hashes, and the accepted outcome receipt. Grounding
  failures, oversized candidates, exhausted turns, timeout, and cancellation
  remain fail-closed without repair. Terminal candidate steps now persist only
  SHA-256 and byte counts, preventing rejected raw output from leaking through
  `subagent.step`; cross-workspace fixture import validates and rebinds the
  repair receipt chain.
- Independent Subagent outcome review. `POST
/api/threads/:threadId/subagents/:taskId/outcome/review` requires an explicit
  reviewer model different from the worker and invokes it with no tools,
  bounded retries, and a fixed timeout. The strict review scores task
  alignment, evidence grounding, uncertainty honesty, and actionability,
  returning accept/revise/reject/inconclusive, score, risk, reason, concerns,
  usage, and hashes binding both models, the outcome receipt, criteria, input,
  prompt, response, and schema. Provider or parse failures become
  `inconclusive` without exposing raw errors. The operation is no-store,
  promoted into OpenAPI, and available from Trace using the globally selected
  model; it cannot mutate or stall the settled delegation.
- Compaction-immune delegation ledger projection. Every parent provider
  request now receives a freshly derived bounded system block from durable
  Thread Subagent tasks, including sanitized task labels, state/model/counter
  metadata, prompt/intent/result/error/outcome hashes, and separate
  selected-projection and full-task-set SHA-256s without raw prompts, results,
  or errors. The block
  refreshes after tool turns and is rebuilt across later Runs, child recovery,
  and replay import without entering conversation history. `context.prepared`
  and hash-only `context.delegation.updated` events carry projection counts and
  hashes for Trace without persisting projection content. `delegate_task` now
  rejects equivalent pending/running/completed role + canonical-prompt intents
  while permitting failed/cancelled/timed-out retries, and restored
  coordinators recover their per-Run total from durable tasks.
- Durable live Run control inbox. The Pi loop now drains one steering message
  after a completed turn or one follow-up when it would otherwise stop, while
  preserving the original Run budget and never aborting in-flight tools.
  Queue acceptance appends bounded `run.control.queued` evidence; delivery
  atomically commits `run.control.delivered` plus the exact `message.user`, and
  completion/failure/cancellation/restart atomically settles undelivered items
  as `run.control.cancelled`. Public projections expose only mode/status,
  text SHA-256/size, timestamps, event anchors, reason, and stable content hash.
  Strict promoted queue/list/cancel APIs add no-store identity/count/hash
  headers, ThreadDetail includes the ordered projection, and the running
  Workbench composer now switches between Steering and Follow-up while keeping
  Stop available. Queue cardinality is bounded, demo runs reject unsupported
  control, recovery summaries are hash-only, and OTLP remains metadata-only.
- Shared Agent-profile and Subagent-coordinator limit normalization without a
  second silent runtime clamp.
- Auditable delegation events and dedicated Trace workcells that preserve
  returned evidence, failures, usage, and terminal state across restarts.
- Reviewed MCP extension registry with provenance digests, capability approval,
  per-tool schema/effect review, Agent enablement, and fail-closed revocation.
- MCP Extension list/proposal/review/enable/connect/disconnect/tool-review
  responses now expose no-store hashes, trust/connection/revision headers,
  capability/tool/enabled-Agent counts, and package-binding hashes for polling.
- Reviewed MCP tool routing hints as local operator-authored metadata, surfaced
  to the Agent separately from untrusted MCP server descriptions and cleared on
  tool rejection.
- Deferred MCP schema search through a read-only `mcp_schema_search` tool that
  loads only matched approved external tool schemas into the next Agent turn.
- Ed25519 Extension publisher anchors with environment-backed local signers,
  verify-only SPKI enrollment, canonical key IDs, private-key match checks,
  bounded workspace cardinality, irreversible revocation, and SQLite migration.
- Versioned signed MCP package manifests freezing publisher identity, normalized
  transport, requested capabilities, sorted tool schemas/effects, reviewed
  routing hints, creation/expiry metadata, stable manifest content SHA-256,
  complete manifest artifact SHA-256, and an independently hashed signature
  envelope.
- Canonical stdio executable evidence using no-follow regular-file handles,
  256 MiB bounds, streamed SHA-256, canonical-path and symlink rejection, and
  size/mtime/inode drift checks before and after hashing.
- Trusted package import that enforces a 4 MiB JSON boundary, nested strict
  validation, current publisher trust, duplicate package/name rejection, and a
  fresh pending Extension with no inherited capability, tool, or Agent approval.
- Reviewed in-place signed package updates with server-recomputed deep
  publisher/version/transport/capability/tool/schema/effect/routing-hint/
  executable diffs, package-binding SHA-256 compare-and-swap, and independent
  confirmation for publisher/key changes and SemVer rollback or opaque version
  transitions.
- Bounded append-only package supersession history with signed-envelope replay,
  sequence, hash-chain, successor, package-name, restart, and legacy SQLite
  migration validation while preserving the installed Extension ID.
- Atomic update settlement that disconnects the old transport and clears source,
  capability, tool, and Agent approval before the candidate can be exposed,
  plus a semantic no-op for an identical envelope.
- Signed manifest dependencies with canonical normalized package names,
  32-entry bounds, exact/wildcard/caret/tilde/comparator-intersection SemVer
  ranges, strict opaque-version rejection, dependency diff evidence, and
  explicit schema-2 emission while preserving schema-1 dependency-free
  artifacts.
- Dependency-aware package deployment for up to eight envelopes and 16 MiB,
  including automatic install/update classification, missing/version/cycle
  rejection, dependency-first ordering, set-wide risk confirmation, stable
  whole-plan SHA-256, and one SQLite-CAS all-or-nothing commit.
- Self-contained signed Extension package lockfiles that export installed
  dependency-closed package sets with complete signed envelopes, canonical
  package/dependency rows, stable generation-time-independent content hashes,
  offline trust verification, and replay through the normal deployment gates.
- Policy-bound signed package rollout channels that pin a named lockfile
  revision to allowed package names, publisher key IDs, package-count limits,
  trusted-publisher checks, and dependency-closure checks before reusing the
  normal deployment CAS path.
- Signed Extension package channel indices that summarize active rollout
  channels with channel hashes, lockfile hashes, package/dependency counts,
  package-envelope set hashes, optional lockfile locators, and policy hashes
  under an Ed25519 registry signature without embedding lockfile envelopes or
  local approval state.
- Final-graph validation on single import/update plus recursive dependency
  trust/range checks during Agent tool assembly, connection, policy, and actual
  MCP call, with revocation settlement cascading to dependent clients.
- Connect-time signature/configuration/executable revalidation, exact discovered
  tool catalog matching, signed-effect enforcement during local review, and
  SQLite-backed publisher/configuration checks immediately before policy and
  actual MCP tool execution.
- Publisher revocation settlement that atomically clears enablement and
  connection state for bound Extensions, closes local clients through the REST
  control plane, and blocks already exposed Agent tool closures.
- Dependency-free Streamable HTTP MCP client with session negotiation,
  response limits, redirect denial, endpoint screening, and untrusted-output
  labeling.
- Sandboxed stdio MCP JSON-RPC client with absolute executable enforcement,
  explicit environment mapping, bounded protocol lines, cancellation,
  deterministic shutdown, and stderr suppression.
- macOS `/usr/bin/sandbox-exec` adapter with private temporary HOME,
  capability-derived network/workspace rules, no shell invocation, and
  fail-closed unsupported platforms.
- Linux `/usr/bin/bwrap` adapter with an empty mount namespace, default network
  isolation, capability-derived workspace mounts, explicit executable binding,
  private writable `/tmp`, argument-boundary protection, and no ambient
  environment.
- Opt-in OCI/container sandbox adapter for Windows or explicitly containerized
  deployments, with configured image selection, no-new-privileges,
  capability-derived mounts/networking, and env-name-only command arguments.
- Isolated process groups for sandbox wrappers, with descendant cleanup on
  cancellation, timeout, output exhaustion, normal exit, and forced shutdown.
- Minimal macOS Node runtime rules for root-directory data and literal ancestor
  metadata without widening descendant workspace access.
- Lease-gated Run creation and finalization with worker-only raw tokens,
  SHA-256-at-rest ownership, renewable heartbeats, deterministic trigger IDs,
  and stale-worker rejection.
- ThreadDetail snapshots now return no-store content hashes and run/event/plan/
  evaluation/subagent/recovery count headers for operator polling.
- Thread create, replay import, goal set/clear, and branch responses now reuse
  the ThreadDetail projection headers; stop controls expose no-store receipts,
  and resume streams expose thread/run intent headers under SSE no-cache.
- Thread event projections now return no-store content hashes, requested
  `after` sequence, event count, and first/last returned sequence headers for
  incremental polling.
- Durable interval and five-field UTC cron schedules with anchored advancement,
  bounded claims, heartbeat renewal, overlap skips, misfire policies,
  trigger-level deduplication, and lifecycle evidence. Schedule list/create/
  update APIs are no-store and expose projection/list hashes, status, revision,
  next-run, and active/paused count headers without copying prompts into Ledger
  events.
- Authenticated inbound webhook channels with one-time bearer tokens, bounded
  JSON bodies, uniform public authorization failures, hashed idempotency keys,
  durable delivery receipts, and exactly-once Run creation.
- GitHub webhook channel adapter that keeps Napier bearer/HMAC authorization,
  derives deduplication from `X-GitHub-Delivery`, normalizes repository/action
  metadata into Agent work, and exposes only a delivery fingerprint instead of
  the raw delivery ID.
- Slack Events API channel adapter that keeps Napier bearer/HMAC authorization,
  derives deduplication from `event_id`, normalizes team/app/channel/user/text
  metadata into Agent work, and exposes only an event fingerprint instead of the
  raw Slack event ID.
- Linear webhook channel adapter that keeps Napier bearer/HMAC authorization,
  hashes webhook ID, timestamp, entity type/action, and entity ID for
  deduplication, normalizes issue/project metadata into Agent work, and exposes
  only an event fingerprint instead of the raw webhook identity tuple.
- No-store inbound adapter preview API that parses sample headers/body through
  the selected channel adapter and returns receipt/body/message hashes,
  idempotency fingerprint, bounded message preview, and matching
  adapter/hash/fingerprint response headers without creating deliveries, Runs,
  or Ledger events. Automations now shows the adapter preview receipt hash
  alongside the message hash.
- Server-owned inbound adapter catalog exposed through Bootstrap and
  `/api/channels/adapters`, including labels, idempotency source, required
  headers, sample headers/body, and security notes so the Automations UI no
  longer hardcodes adapter examples; both surfaces expose the catalog SHA-256
  for drift checks.
- Inbound delivery projections and Ledger events now include the channel
  adapter ID, channel revision, raw inbound body SHA-256, and adapter catalog
  SHA-256, binding accepted/started/completed/retry evidence to the parser
  input and channel configuration without storing raw webhook bodies. Accepted
  and duplicate inbound receipts are no-store and mirror content hash,
  duplicate flag, channel/thread/delivery/trigger identity, optional Run ID,
  delivery status, revision, fingerprint, and public hash evidence in response
  headers.
- No-store inbound delivery list projection with content hash, delivery total,
  channel ID, delivery-list hash, delivery-ID set hash, and per-status count
  headers for Automations polling and CI checks.
- No-store inbound delivery qualification endpoint for checking whether a
  delivery has body/catalog hash evidence and whether its adapter catalog hash
  still matches the current server-owned catalog, with a stable receipt hash
  surfaced directly on Automations delivery rows and channel/delivery identity,
  status, diagnostic-count, current-catalog, and optional hash-evidence response
  headers for machine checks.
- Optional HMAC-SHA256 webhook body signatures using the one-time channel
  token as the signing key, with timestamp-skew enforcement, no raw signing
  secret persistence, and Ops Workbench controls for requiring signed bodies.
- Built-in inbound webhook policy templates (`legacy_bearer`,
  `signed_standard`, `signed_strict`, and `custom`) with strict API parsing,
  public template labels, and automatic custom derivation after policy edits.
- Revisioned inbound webhook signature policies that let Ops require or relax
  HMAC verification and tune timestamp tolerance through bounded API and
  Workbench controls without exposing tokens or rewriting delivery evidence.
- Atomic webhook token rotation with immediate previous-token revocation,
  fingerprint-only ledger evidence, inline confirmation, and one-time
  replacement display. Channel create/status/retry-policy/signature-policy and
  token-rotation responses are no-store and expose channel projection hashes,
  status, revision, policy template, and token fingerprint headers without
  hashing raw one-time tokens.
- Channel list responses are no-store, token-free, and expose a content
  SHA-256 plus total/active/disabled channel count headers for operator
  polling and CI smoke checks.
- Bootstrap is now no-store and content-hash-bound as a whole response while
  still mirroring channel-list digest/count headers and adapter catalog
  digest/count/adapter-ID set headers for decomposed drift checks.
- `/api/channels/adapters` now mirrors the same no-store adapter catalog digest,
  adapter count, and adapter-ID set hash headers used by Bootstrap for drift
  checks.
- Delivery-derived channel trigger IDs that preserve stable deduplication
  without indirectly exposing the full idempotency-key digest.
- Revisioned per-channel retry policies with one-to-ten attempt bounds,
  configurable base delay, immutable delivery policy snapshots, pre-Run
  exponential backoff, due-time sweeps, and attempt-specific trigger IDs.
- Versioned dead-letter JSON exports with retry disposition, message hashes,
  stored body/catalog SHA-256 evidence, current catalog comparison status,
  top-level qualified/missing/drift summary counts, canonical content SHA-256,
  no queued message/authentication material, matching response hash/count
  headers, channel/thread identity, delivery-ID set hashes, retry-disposition
  counts, and Ledger audit events with the same counts. Operators can upload the
  artifact to a no-store verifier that recomputes the canonical hash and checks
  delivery and qualification summaries while mirroring declared/recomputed
  hashes and observed counts. A two-phase retry preview/apply flow binds
  explicit replay confirmation to the preview SHA-256 and top-level delivery ID
  set summaries repeated in the apply receipt. Preview/apply responses now
  mirror channel identity, verification status, candidate/diagnostic counts,
  retry/skipped counts, and public set hashes in response headers. A no-store
  retry history projection now lists prior bulk apply events with event IDs, seq
  boundaries, event-set hashes, apply result hashes, counts, and public hash
  summaries for operator audit. Retry-history downloads expose direct-download
  content-disposition plus channel/thread identity, content/event-set hash,
  event-count, and first/last seq headers. The projection can be posted back to
  a no-store verifier that recomputes the current Ledger-derived hashes and
  reports drift while exposing status and observed content/event-set/count/seq
  headers for machine checks.
  Automations exposes download, upload, and verification controls from the
  retry-history card.
- Fail-closed manual retry for failed or restart-unknown deliveries, including
  explicit side-effect confirmation, replayable requested/started/terminal
  events, and no-store retry response headers for content hash, status, attempt
  counts, revision, channel/thread/delivery/trigger identity, optional Run ID,
  fingerprint, public evidence hashes, and next-attempt timing.
- Active-only delivery polling that refreshes accepted, running, and retrying
  UI projections, then stops automatically at terminal state.
- Background schedule and channel workers with bounded sweeps, restart
  reconciliation, caught background failures, and graceful shutdown.
- Schedule and channel REST APIs that expose fingerprints and receipts without
  serializing raw lease tokens, bearer tokens, idempotency keys, queued
  messages, or model overrides.
- Extension management API and Paper Ledger inspector covering proposal,
  approval, discovery, tool review, and enablement as replayable events.
- Lazy-loaded Extensions Workbench with HTTP/stdio transport selection,
  absolute-executable validation, one-argument-per-line parsing,
  workspace-scoped cwd, secret-free environment source mappings, derived
  capability review, per-tool routing-hint review controls, and persisted
  approved-state rendering across reloads.
- Paper Ledger Publisher & Package Desk with signer/public-key enrollment,
  two-step revocation, eligible-catalog signing and JSON download, offline file
  verification, trusted file import, stamped hash receipts, package provenance
  cards, keyboard-native controls, and 285px Inspector containment.
- Paper Ledger package revision ticket with current/candidate identity,
  version-direction stamps, frozen change tags, capability/tool/routing-hint
  deltas, review-reset warning, risk confirmations, package history counts,
  and keyboard-native apply/discard controls.
- Paper Ledger Atomic Package Deployment ticket with multi-file selection,
  install/update stamps, signed dependency rows, resolved-source evidence,
  dependency-first order, set-wide risk confirmations, no-op blocking, and
  285px Inspector containment.
- Paper Ledger lockfile export and verification flow that downloads the current
  signed package graph, accepts a lockfile in deployment file selection, unfolds
  it into envelopes, and preserves the deployment CAS/review-reset boundary.
- Paper Ledger rollout channel desk for publishing the current signed graph to
  a named lane, previewing its policy-bound lockfile as an atomic deployment,
  and applying it without inheriting source/tool/Agent approval.
- Paper Ledger channel index registry controls for signing/downloading
  summary-only rollout indices, verifying them offline, and displaying
  stamped index/envelope/channel-count receipts.
- Publisher/package REST APIs with bounded verification/import bodies,
  no-store verification/update/deployment/rollout previews, lockfile export and
  verification endpoints, hash-addressed rollout lockfile retrieval, rollout
  publish/apply endpoints, channel-index sign/verify endpoints,
  digest/key/content download headers, semantic 400/409 failures,
  cross-workspace package portability, and hash-only Ledger events that omit
  manifests, schemas, dependencies, signatures, public keys, private locators,
  and binaries.
- Extension package verify, update preview/apply, deployment preview/apply,
  lockfile verify, rollout list/publish/preview/apply, and channel-index verify
  responses now expose no-store content or artifact SHA-256 headers plus
  status, revision, CAS, package, dependency, install/update, and envelope-count
  headers for operator polling without expanding package bodies into headers.
- Extension package lockfile export and hash-addressed retrieval now also
  mirror dependency counts plus package-envelope, normalized package-name, and
  publisher-key set hashes without exposing manifests or signatures in headers.
- Skill package verify/qualify/install/list, Skill content preview/apply,
  Prompt package verify/qualify, and Inspector package verify/qualify responses
  now expose no-store content or artifact SHA-256 headers plus status, count,
  catalog, observed-drift, review, and key metadata headers without mirroring
  Skill instructions, Prompt text, or Inspector UI/source content.
- Restart reconciliation that marks orphan runs `interrupted`, closes in-flight
  subagents, repairs Thread state, and emits idempotent recovery evidence.
- Lease-gated branch materialization, preventing another local instance from
  mistaking an in-progress branch projection for abandoned work.
- Explicit SSE run recovery with parent-run linkage, unknown-side-effect
  warnings, durable evidence projection, and a dedicated Workbench checkpoint.
- Agent-level `manual | safe_read_only` recovery policy with bounded attempts
  and backoff, append-only profile revisions, rollback support, and schema-2
  Run fingerprint binding while preserving schema-1 hashes as manual-only.
- Metadata-only automatic-recovery assessments that bind the interrupted
  configuration and Run-local event stream, fail closed on unmatched
  `tool.started`, write/delegation tools, unknown effects, demo models,
  imported provenance, malformed chains, or exhausted attempt budgets, and
  reject report tampering through canonical SHA-256 validation.
- SQLite-CAS recovery claims with hashed worker-only tokens, renewable
  heartbeats, expired pre-Run claim takeover, deterministic root/attempt
  triggers, multi-instance deduplication, bounded restart-chain attempts, and
  durable claimed/running/terminal attempt hashes.
- Snapshot-bound automatic recovery execution using the interrupted Run's
  exact Agent revision and model under `safe_read_only_recovery`, forced
  `observe`, local list/read/search only, and no plan tools, Extensions,
  Subagents, verification processes, or Memory extraction.
- RecoveryService lifecycle integration, no-store Thread recovery REST,
  content hash plus assessment/attempt count headers, hash-only
  `run.recovery.auto.*` evidence backfill, graceful shutdown, and retained
  independent manual Resume behavior.
- Paper Ledger interruption controls in Context plus a live Ops recovery
  register with qualified/blocked/completed counts, canonical reason copy,
  source/event digests, narrow-layout containment, and keyboard-native order.
- Immutable replay snapshots with event-stream SHA-256, aggregate usage,
  output hashes, structured event/tool deltas, JSON export APIs, and no-store
  response headers for content hash, event-stream hash, run/thread IDs, event
  count, event sequence boundaries, duration, model/message/tool/subagent
  counts, token/cache totals, cost USD, and output-text hash.
- Prompt-redacted per-Run configuration fingerprints binding the actual model
  override, Agent revision, policies, canonical capability sets, effective
  limits, and system-prompt SHA-256 to an independent canonical content hash.
- Run Lab configuration-drift comparison with changed fields, capability
  additions/removals, both fingerprint hashes, and explicit unavailable state
  for legacy Runs rather than reconstructed history. Comparison responses are
  no-store and mirror content hash, left/right Run IDs, event-stream hashes,
  event counts, left/right Run metrics, right-minus-left metric deltas,
  event-type delta hashes, added/removed tool-set hashes, configuration delta
  status, changed-field and capability-set count/hash headers, output-changed
  status, and available configuration hashes.
- Fail-closed fingerprint validation in SQLite restore and full-thread fixture
  import, including exact-key and duplicate Run revision/limit consistency.
- Versioned full-thread replay fixtures covering Agent configuration, Runs,
  plans, evaluations, evaluation suites and executions, subagents, and ordered
  events, with independent canonical content/event-stream SHA-256 digests and
  a 10 MiB import boundary. Fixture exports mirror no-store content/event-stream
  hashes, thread ID, run/event counts, and event sequence boundaries in headers.
- Atomic fixture import with complete resource-ID remapping, recursive event
  payload reference rewriting, suite/execution/evaluation reference remapping
  and digest recomputation, trigger/lease removal, provenance retention, and
  fail-closed conversion of in-flight Runs, plan steps, and subagents.
- Portable automatic-recovery assessments and attempts with remapped
  Agent/Thread/root/source/child/attempt IDs, recomputed Run-local event,
  assessment, trigger, and attempt hashes, closed imported claims, and
  unconditional imported-history exclusion from new automatic recovery.
- Imported-history prompt boundaries that label the original sequence range as
  untrusted historical data and bind it to both source hashes.
- Public fixture attachment/import APIs and a Paper Ledger portable-ledger card
  with accessible file input, source digest, count register, transfer receipt,
  and automatic navigation to the imported Thread.
- Strict Thread replay import wrapper parsing that rejects unknown fields,
  missing bundles, and empty titles before fixture validation or state import.
- OpenTelemetry-compatible OTLP/JSON artifacts for complete Threads or single
  Runs, with deterministic 128-bit trace IDs, 64-bit span IDs, nanosecond
  timestamps, one Thread root, Run children, GenAI model/tool/Subagent spans,
  and metadata-only Ledger events.
- Strict OTLP validation for envelope keys, semantic-convention schema,
  AnyValue types, ID uniqueness, parent references, cycle freedom, child/event
  temporal containment, counts, source event hashes, artifact size, and stable
  content SHA-256.
- Privacy-safe trace projection that excludes prompts, completions, reasoning,
  tool I/O, Subagent text, review/evidence/error prose, credential labels,
  arbitrary user IDs, and key locators while retaining allowlisted resource
  IDs, status, model/tool metadata, usage, cost, durations, and hashes.
- No-store Trace export REST with content/trace/event-stream/span headers and
  `trace.otlp.exported` Ledger evidence containing only scope, IDs, counts, and
  hashes; streaming deltas and prior exports are excluded for deterministic
  repeated output.
- Trace export responses now also mirror Thread/Run IDs, event seq range,
  event counts, redaction mode, content-capture status, and excluded metadata
  counts in headers while keeping OTLP span details in the artifact body only.
- Paper Ledger Trace export card with complete-Thread or single-Run scope,
  OTLP download, span/event counts, artifact digest receipt, keyboard-native
  controls, and explicit metadata-only safety copy.
- Independent no-tool rubric evaluation with strict JSON parsing, preserved
  rubric snapshots, hash-bound evidence, fail-closed verdicts, and no-store
  evaluation list count/hash headers.
- Revisioned Evaluation Suites over one terminal baseline and 1–8 distinct
  terminal candidates, with immutable rubric/model/gate snapshots and
  semantic-change-only revision advancement.
- Quality gates for minimum conclusive pass rate, minimum candidate score, and
  explicit inconclusive policy, including fail-closed all-inconclusive
  batches.
- Per-case pair-evaluation SHA-256 and canonical batch content SHA-256 binding,
  with aggregate tamper validation, referenced-evaluation retention, SQLite
  restart recovery, and atomic fixture round trips.
- Evaluation Suite REST APIs and Ledger events for create, update, list, and
  execute operations without duplicating rubric descriptions into event
  payloads.
- Evaluation Suite create/update/execution responses now expose no-store
  suite/execution hashes, IDs, revisions, candidate/case counts,
  passed/failed/inconclusive aggregates, status, and pass-rate headers.
- Lazy Run Lab Evaluation Suite docket for baseline/candidate selection,
  thresholds, revision editing, execution status, score aggregates, and batch
  digests; only the current revision may present a current gate result.
- Self-contained `napier.evaluation-gate-receipt` artifacts containing the
  current suite snapshot, current-revision execution, and complete ordered
  pair evaluations under a stable canonical content SHA-256.
- Explicit `not_run` receipts after semantic suite revisions, strict receipt
  envelope/case/aggregate/hash validation, no-store attachment responses, and
  `X-Napier-Content-SHA256` for CI correlation.
- Evaluation Suite list, execution list, and gate receipt responses now expose
  no-store response hashes plus suite, execution, case, revision, candidate, and
  gate-state headers for machine polling.
- Run Lab case evidence with verdicts, baseline/candidate means, pair hashes,
  five-entry execution history, and receipt download without moving those
  controls into the main browser chunk.
- Append-only human evaluation adjudication with one truth record per
  immutable pair evaluation, sequential revisions, semantic no-ops, bounded
  notes, evaluation SHA-256 binding, independent revision hashes, and no-store
  list headers for adjudication/revision counts.
- Reviewer ballot and consensus REST projections now expose no-store response
  hashes, ballot/revision counts, consensus status, reviewer/agreement counts,
  and consensus-resolution counts for CI polling.
- Evaluation create, adjudication write, reviewer ballot write, and consensus
  resolve responses now expose no-store hashes, IDs, revisions, verdict/status,
  reviewer/agreement counts, and report/resolution hashes for polling.
- Evaluator calibration reports grouped by provider/model and canonical rubric
  SHA-256, with exact agreement rates, complete 4×4 verdict confusion matrices,
  stable report hashes, no-store responses, digest headers, and sample/
  agreement/group count headers.
- Adjudication persistence validation, reviewed-evaluation retention,
  backward-compatible SQLite field migration, and fail-closed duplicate,
  cross-Thread, stale-hash, timestamp, or revision-tamper rejection.
- Portable adjudication fixtures with bounded schema validation, adjudication
  and evaluation ID remapping, recomputed evaluation/revision SHA-256 evidence,
  recursive Ledger reference rewriting, and legacy fixture compatibility.
- Evaluation adjudication/calibration REST APIs with `201` creation, `200`
  revision/no-op semantics, strict raw JSON validation, and hash-only
  `evaluation.adjudication.reviewed` Ledger events that omit review notes.
- Paper Ledger calibration register with review coverage, evaluator/rubric
  cohorts, matrix drill-down, inline truth revisions, agreement state, report
  digest, case-level expected verdicts, keyboard semantics, and reload
  persistence inside the lazy Run Lab chunk.
- Workspace-wide Evaluation Casebooks that curate only human-reviewed
  evaluations across Threads into revisioned, hash-bound gold sets.
- Append-only Casebook case registries with sorted revision manifests,
  semantic curation no-ops, explicit truth refresh, historical removal
  preservation, bounded case/revision counts, and linear evidence storage.
- Case snapshots binding complete model evaluation, selected adjudication
  revision, source IDs, rubric/evaluation/adjudication hashes, timestamp, and
  independent canonical case SHA-256.
- Casebook calibration through the shared sample/cohort/confusion-matrix
  protocol, plus 10 MiB `napier.evaluation-casebook` artifacts with stable
  generation-time-independent hashes and no-store digest headers.
- Strict Casebook transition and artifact validation covering duplicate,
  unreferenced, conflicting, non-canonical, future-timestamp, and tampered
  evidence, with atomic SQLite persistence and CAS retries.
- Online deduplicating migration from the development embedded-case revision
  shape to the append-only registry/manifest representation, persisted once
  without deleting historical evidence.
- Casebook REST APIs and hash-only Ledger events for create, metadata revision,
  curate, refresh, remove, calibration, list, detail, and export operations.
- Casebook create/update/curate/remove and qualification execution responses
  now expose no-store Casebook or execution hashes, revision/case counts,
  audit Thread IDs, status, sample/agreement/inconclusive/unverified counts,
  and agreement-rate headers.
- Paper Ledger Casebook archive with cross-Thread curation, stale-truth refresh,
  two-step removal, cohort agreement, revision history, artifact download, and
  reload-persistent state inside the lazy Run Lab chunk.
- Executable Casebook qualification over the current revision, with selectable
  evaluator, minimum exact-agreement gate, explicit inconclusive policy, and
  no-tool re-judging that does not create ordinary pair-evaluation history.
- Per-case source replay reconstruction and dual snapshot-hash verification;
  missing or drifted evidence bypasses the evaluator and forces the
  qualification execution to fail closed as `inconclusive`.
- Canonical qualification execution hashes over revision, audit Thread, model,
  gate, case order, expected/actual verdicts, scores, evidence state, counts,
  agreement rate, and final status, with strict structural/tamper validation.
- SQLite-backed qualification history with current-revision save protection,
  latest-20 retention per Casebook, legacy missing-field migration, restart
  validation, and hash-only completion Ledger events.
- Self-contained `napier.evaluation-casebook-qualification-receipt` artifacts
  that cannot borrow an execution from a prior Casebook revision, including
  explicit `not_run`, no-store attachment responses, and digest headers.
- Evaluation Casebook list/detail, calibration, export, qualification history,
  qualification receipt, and baseline-list responses now expose no-store hashes,
  case/revision counts, qualification status totals, and baseline digests for
  machine polling.
- Paper Ledger qualification desk with keyboard-operable model/gate controls,
  case-level verdict and source-hash evidence, revision-aware execution
  history, receipt download, reload persistence, and corrected vertical
  Inspector scrolling.
- Independent multi-reviewer ballot lanes per immutable evaluation, with
  normalized reviewer IDs, display-name snapshots, bounded notes, append-only
  revisions, semantic no-ops, evaluation binding, and canonical revision
  SHA-256.
- Consensus reports with 2–9 reviewer quorum, 50%–100% exact-agreement gates,
  unique-leader enforcement, explicit inconclusive policy, four-verdict
  distributions, stable generation-time-independent hashes, and no-store
  preview responses.
- Atomic consensus resolution that recomputes current votes, appends
  `reviewer_consensus` provenance to Human Truth, persists the exact report and
  adjudication revision in one SQLite commit, and deduplicates repeated report
  hashes.
- Privacy-safe reviewer Ledger events that retain reviewer lane IDs, verdicts,
  revision numbers, and hashes while omitting display names and private ballot
  rationales; direct adjudication rejects client-supplied provenance fields.
- Portable reviewer ballots and consensus resolutions with collision-free ID
  remapping, ordered ballot/report/adjudication/resolution hash recomputation,
  missing-provenance rejection, and backward-compatible optional fixture
  fields.
- Consensus-derived Casebook cases that freeze exact ballot histories and the
  matching resolution, making panel-reviewed gold-set artifacts
  self-contained and fully covered by the case SHA-256.
- Paper Ledger reviewer sign-off desk with roster editing, verdict
  distribution, quorum/agreement controls, readiness states, explicit truth
  resolution, provenance labels, keyboard flow, and reload persistence.
- Workspace-global Ed25519 receipt trust anchors with canonical SPKI public
  keys, SHA-256 key IDs, environment-backed local signing or verify-only
  import, bounded registries, duplicate rejection, and irreversible
  revocation.
- `napier.trusted-receipt-envelope` artifacts for Evaluation Suite gates and
  Casebook qualification receipts, with domain-separated statements binding
  stable content SHA-256, complete artifact SHA-256, signer, and signing time.
- Deep offline receipt verification that replays nested gate/qualification
  validators before classifying signatures as `trusted`, `revoked`,
  `unknown_key`, or `invalid`, including time-metadata and signature tamper
  rejection.
- Append-only passing qualification baselines that freeze the complete signed
  envelope, exact Casebook revision and execution, supersede prior pins,
  preserve referenced execution history, and become stale or revoked without
  borrowing old qualification results. Baseline promotion responses now expose
  no-store result hashes, created flags, baseline/execution hashes, receipt
  artifact hashes, envelope hashes, and signer key IDs for release gating.
- Strict trust REST APIs with no-store signed downloads, digest/key headers,
  bounded verification uploads, semantic conflict status codes, and
  privacy-safe Ledger events that omit key locators, public-key bytes, private
  keys, signatures, and receipt bodies.
- Receipt Trust anchor list/create/revoke and verifier responses now expose
  no-store hashes, anchor state/count headers, key IDs, verification status,
  signature validity, and integrity validity for machine audit.
- Paper Ledger receipt trust desk with local-signer and verify-only enrollment,
  selectable signing identity, two-step revocation, JSON envelope verification,
  signed Suite/qualification receipt downloads, and stamped baseline state.
- Incremental context compaction with verified source/summary hashes, recent
  raw-message retention, reusable parent checkpoints, no-tool strict-JSON
  summaries, explicit fallback evidence, hash-bound calibration reports, and
  Goal evaluator reuse.
- Context Inspector checkpoint cards for coverage, continuity summary,
  decisions, open loops, artifacts, both evidence hashes, calibration hash,
  coverage rate, compression, and fallback counts.
- Repository-root workspace inference for npm workspace production starts,
  while preserving explicit `NAPIER_WORKSPACE` overrides.
- Dependency-aware durable execution plans, evidence-gated step transitions,
  same-Thread run ownership, first-wins terminal outcomes, and restart
  reconciliation for unknown in-flight work, plus persisted critical-path,
  ready-step, and blocked-step projections.
- Internal planning tools and artifact manifests with workspace confinement,
  actual file observation, runtime-computed SHA-256, and bounded hashing.
- Plan APIs and a Paper Ledger Plan Workbench for DAG progress, critical-path
  scheduling, verification criteria, blockers, evidence, artifact status, and
  source hashes.
- Bounded strict JSON parsing for Plan creation, step transition, and artifact
  settlement APIs, rejecting unknown fields and malformed IDs, status values,
  digests, sizes, or oversized bodies before runtime state mutation.
- Governed Plan replanning with revision compare-and-swap, explicit
  recover-blocked/scope-change/artifact-drift strategies, dependency
  redirection, superseded stale steps/artifacts, appended replacement work, and
  hash-bound replan history exposed through REST, Agent tools, Ledger events,
  and the Plan Workbench.
- Hash-bound Plan replan recommendations for blocked critical paths and missing
  artifacts, exposed in the Plan projection, Agent tool results, and Workbench
  signal cards with the expected revision for the next replan CAS.
- Generated `napier.plan-replan-draft.v1` replacement-plan drafts attached to
  replan recommendations, including blocked-step recovery steps, downstream
  dependency rewrites, missing-artifact restore steps, and replacement artifact
  manifests plus deterministic score/risk evaluation that still require normal
  replan CAS before mutation.
- Model/thinking-specific replan policy templates in Agent planning-tool
  output, with conservative/balanced/expansive postures, bounded checklists,
  review instructions, and canonical template SHA-256 evidence.
- No-store replan draft model-review artifacts for active recommendations,
  binding model score/risk/verdict to the recommendation SHA-256, draft hash,
  deterministic evaluation hash, prompt hash, response hash, and final review
  hash without mutating Plan state or bypassing replan CAS, now exposed from
  the Plan Workbench beside explicit draft application through normal replan
  revision CAS.
- Plan list, create, replan, step transition, artifact settlement, and replan
  draft review responses now expose no-store hashes, plan status/revision
  headers, step/artifact/replan counts, scheduling projection counts, and active
  recommendation/review digests for machine polling.
- Pi-compatible credential references for environment-variable names and
  macOS Keychain service/account locators, with transient resolution,
  availability checks, fail-closed missing references, and metadata-only
  audit events.
- Credential list/create/check/status and macOS Keychain write responses now
  expose no-store hashes, status/availability counts, provider/source-type
  headers, revision headers, and last-check timestamps without mirroring secret
  locators or secret bytes into headers.
- Bounded macOS Keychain credential writes that accept a secret once, call the
  Keychain vault adapter, persist only the provider locator, and keep Ledger
  events secret-free.
- Revisioned Agent configuration persistence and validation for default model,
  thinking level, policy, tools, skills, delegation roles, and bounded
  parent-Run/Subagent budgets.
- Canonical, hash-bound Agent profile snapshots for every semantic revision,
  including changed-field provenance, System Prompt SHA-256, source, and
  tamper validation without copying Prompt text into Ledger events.
- Schema-3 Run configuration fingerprints that bind the enabled Skill catalog
  SHA-256, plus `context.skills` Ledger evidence containing Skill names,
  relative paths, byte counts, diagnostics hashes, and file SHA-256 values
  without copying Skill instructions.
- Automatic recovery Skill-catalog drift blocking: schema-3 interrupted Runs
  recompute the current enabled Skill manifest before recovery and abandon the
  claim without creating a child Run when the hash has changed.
- Skill package signing, verification, and workspace qualification APIs backed
  by the Extension publisher trust domain, with no-store responses, digest
  headers, and hash-only Ledger events.
- Extension publisher anchor list/create/revoke responses now expose no-store
  hashes, trusted/revoked/signing-capable counts, key IDs, anchor IDs, and
  status headers for package-provenance polling.
- Reviewed Skill package installation baselines that persist only qualified
  signed catalogs, require explicit active-baseline replacement confirmation,
  require separate publisher/key and loaded Skill-set change confirmations, and
  record hash-only install/replacement Ledger evidence.
- Reviewed Skill content preview/apply APIs that validate bounded `SKILL.md`
  text, fix the target to `skills/<name>/SKILL.md`, require a stable review
  SHA-256 plus explicit install/replacement confirmation, expose hash-only
  byte/line diff metadata and frontmatter/body hashes, write through the
  hash-preconditioned atomic workspace writer, and keep Ledger evidence
  hash-only.
- Prompt package signing, verification, and Agent qualification APIs backed by
  the Extension publisher trust domain, freezing Agent revision SHA-256 and
  System Prompt SHA-256 without copying prompt text into envelopes or Ledger
  events.
- Inspector package signing, verification, and Workbench qualification APIs
  backed by the Extension publisher trust domain, freezing the Inspector
  catalog SHA-256, panel IDs, panel capabilities, and default panel with
  hash-only Ledger events.
- CAS-protected migration of legacy SQLite state to one persisted `migrated`
  baseline, with duplicate, missing-current, future-revision, and hash-drift
  validation at startup.
- Append-only Agent rollback that verifies model availability, previews exact
  field differences, requires a second confirmation, and restores historical
  values only by creating a new revision with `agent.rolled_back` evidence.
- Agent profile update, revision-history, and rollback responses now expose
  no-store response hashes, Agent revision headers, profile revision hashes,
  System Prompt hashes, changed-field counts, and rollback source hashes.
- Optional Agent revision ledgers in schema-version-1 portable fixtures, with
  backward-compatible validation, Agent ID remapping, hash recomputation, and
  atomic import.
- Context Workbench profile editing and credential-reference registration,
  checking, enablement, and disablement without any secret-value input.
- Paper Ledger configuration history cards with source/current status,
  changed-field tickets, profile/prompt digests, rollback provenance, and
  reload-persistent confirmation flow.
- Context Workbench Atomic patch and Sandbox verify capability selection with
  policy guidance, plus Software Delivery skill instructions that require
  fresh read hashes, exact replacements, and evidence-aware verifier outcomes.
- Context Workbench parent-Run budget controls for model turns, total tokens,
  maximum USD cost, and wall time, with reload-persistent revisioned values.
- Context Workbench Skill package baseline desk for signing, verifying,
  qualifying, and installing reviewed hash-only Skill catalog baselines with
  separate replacement, publisher/key, and Skill-set risk confirmations.
- Context Workbench Skill content desk for loading or pasting `SKILL.md`,
  previewing action/review hashes and byte/line deltas, requiring
  install/replacement confirmation, and applying reviewed content writes with
  hash-only receipts.
- Context Workbench Prompt package desk for signing, verifying, and qualifying
  hash-only Agent prompt baselines against the current revision.
- Lazy-loaded Evaluation Suite, Memory, Extensions, Context, and Automations
  inspectors that preserve the production main entry at 120.81 kB
  uncompressed; their chunks remain at 50.81 kB, 8.66 kB, 35.34 kB, 57.05 kB,
  and 30.04 kB respectively.
- Paper Ledger Automations register for creating and pausing schedules,
  selecting webhook adapters, creating and disabling channels, dismissing
  one-time token tickets, previewing adapter mappings, revising delivery policy,
  inspecting attempts, confirming safe retries, and exporting hash-bound dead
  letters.
- Paper Ledger workbench with conversation, Trace, Run Lab, Plan, Goal, Memory,
  Extensions, Automations, and Context views.
- Per-run selection across server-discovered, configured model providers.
- Unit coverage for policy boundaries, sandbox argument derivation, event
  ordering, and complete demo runs.
- Transaction fault-injection, simultaneous bootstrap, legacy migration,
  schema-history migration, authorization-material persistence, and
  concurrent-writer coverage for the SQLite ledger.
- Scripted Pi provider coverage for incomplete → continuation → verified goal
  completion.
- Production static serving and a Preact compatibility build under the 150 kB
  main-entry budget.
