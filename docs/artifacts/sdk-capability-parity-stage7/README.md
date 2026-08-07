# SDK capability parity — Stage 8 repaired evidence

This directory proves the bounded addition of a stateless, GET-only
`@napier/sdk/management` client for the existing effective-Agent capability
projection. It does not add SDK mutation, setup, doctor, sandbox, skill-loading,
deployment, or live-model behavior. This slice does not complete overall M0, and
M1–M5 remain out of scope.

The receipts are sanitized and offline. No raw Store contents, response bodies,
absolute temporary paths, child output, generated secret, credential value, or
environment value is retained.

- `four-state-parity.json`: built CLI, real HTTP route, and built SDK equality for
  stale, current, custom-unmanaged, and broken projections, including before/after
  Store and event-manifest digests.
- `production-server-trace.json`: a bounded loopback trace through the actual built
  server entry and the external SDK example using global `fetch`.
- `evidence.json`: causally observed formal-command exits, immutable implementation
  Git blobs, deterministic execution closures, exact repair content, historical gate
  and review receipts, artifact links, and cleanup receipts.

Capture after building Contracts, Runtime, CLI, SDK, and Server:

```sh
node scripts/capture-sdk-capability-parity.mjs --output-dir docs/artifacts/sdk-capability-parity-stage7
```

Capture executes these formal commands and records their bounded output digests:

```sh
npm exec -- vitest run scripts/agent-capability-projection-equality.test.mjs
npm exec -- vitest run scripts/sdk-capability-production-server.test.mjs
node --import tsx scripts/run-credential-reference-canary.ts
```

Ordinary verification checks immutable implementation objects and recorded repair
content without coupling the evidence to the current HEAD. It does not start a
server or change artifacts:

```sh
node scripts/capture-sdk-capability-parity.mjs --output-dir docs/artifacts/sdk-capability-parity-stage7 --verify
```

The stricter capture-snapshot mode additionally requires the exact Stage 8 repair
path set relative to the implementation commit:

```sh
node scripts/capture-sdk-capability-parity.mjs --output-dir docs/artifacts/sdk-capability-parity-stage7 --verify-current
```

The immutable implementation commit is
`d81f77b64998fd786aa7a514f53494adb255e1e5`; rollback is
`git revert d81f77b64998fd786aa7a514f53494adb255e1e5`. The containing
Stage 8 repair commit binds `evidence.json` and is recorded by the external Stage
8 acceptance output after final review. The implementation is additive and has no
persistent schema migration. Never reset or clean protected user files.
