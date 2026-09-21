# Steering and settled-edit recovery

This is an interactive scenario, not a static campaign case. Do not add it to
`harness-core-quality-suite-v1.json`: its final grader checks a requirement that
is delivered later through the real Run control API.

The controller waits for an initial edit and passing structured verification,
queues a user amendment, observes that exact message's delivery, and interrupts
after the next completed edit. A dedicated worker exits without cancelling or
finalizing the Run. Its supervisor waits for that actual exit, then starts a fresh
Node process using production startup reconciliation and manual recovery. It does not edit source
files on the Agent's behalf. The grader is inserted only after recovery settles.

Example (load credentials and explicit OCI overrides as for the main campaign):

```sh
node --env-file-if-exists=.env scripts/run-harness-recovery-scenario.mjs \
  --runtime-root /path/to/frozen/runtime \
  --case-root benchmarks/harness-optimization/steered-fee-policy-v1 \
  --output /new/shared-cache/scenario-output \
  --profile-report /path/to/candidate/trial-1/result.json
```

Omit `--profile-report` for the original default baseline. Each arm receives the
same initial task, amendment, triggers and per-Run limits. A failed/missing trigger
is an incomplete scenario, not a successful observation. Original failures and
private invocation capsules remain under the output directory.

Acceptance requires exact recovery-parent binding, successful independent revised
behavior checks, permitted changed paths and a post-recovery verification whose
snapshot matches final files. When evidence working state is enabled, the first
recovery invocation must additionally retain the source Run, user amendment and
stale pre-edit verification. This checks interrupted task continuity; it does not
claim automatic compaction, unknown-side-effect reconciliation, a paired quality
gate, or cost/latency improvement. Each recovery is a new Run with the normal new
Run budget; do not pool its usage with single-Run campaign observations.
