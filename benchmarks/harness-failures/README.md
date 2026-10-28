# Retained failures

These cases are exported by the existing `buildFailureCase` campaign utility.
They retain the original task, independent grader, initial fixture, and captured
failed output as separate snapshots. They are regression data, not unseen tasks.
The original case ID is preserved so that a copied failure cannot inflate the
independent task count.

`bounded-queue-false-completion-v1` comes from
`run_cef83d950d1c416096e2` (DeepSeek, 2026-09-15). The Run ended as `completed`, but
the independent grader rejected its acceptance of `null` and AbortSignal-shaped
plain objects. The original report bytes were checked against
`8d320c0e26e98add05ded6fd82506d10624c901f5bed34e879c822ac5200d8e1` before export.
Source, model, policy, usage and environment provenance are in `reproduction.json`.
That file's report digest binds the parsed report serialization, while the digest
above binds the original formatted file.
The retained directory is marked `-text` in `.gitattributes` to prevent checkout
line-ending conversion; its original EOF blank lines are also preserved.

Use `harness-failure-regression-suite-v1.json` with the existing optimization suite
runner for future model regression runs. Its `fixture/` is the initial task;
`observed/` is the failed historical output and must never substitute for it.
Offline verification uses the retained grader against an isolated copy of that
output and the existing reference implementation:

```sh
npm exec -- vitest run scripts/harness-retained-failure.test.mjs
```

A deterministic replay of the failed output proves the captured defect and
grader behavior. It does not claim that a current model will reproduce or repair
the failure, or that current task quality improved.
