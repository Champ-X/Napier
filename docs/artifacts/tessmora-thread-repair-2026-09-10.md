# Tessmora Skill integration: failed-thread diagnosis and verification

Verified locally on 2026-09-10 against Napier at `127.0.0.1:5173` / `8788`
and Tessmora at `127.0.0.1:8000`.

Thread: `thread_95954117ba3846f49fc0`, workspace `/Users/champ/Projects/testNapier`.
User task: retrieve the undergraduate transcript application procedure with
original knowledge-base illustrations.

## Causes and fixes

1. **Installation scope did not match the thread workspace.** The initial
   project Skill was installed only in the Napier source checkout. Installed
   the shared user Skill at `~/.agents/skills/mma-rag` using the reproducible
   `scripts/install-tessmora-skill.mjs` installer and enabled it on the actual
   workspace Agent. Agent enablement remains workspace-specific.
2. **Permission presets discarded custom Skills.** The composer's default
   `full_access` replaced configured Skills with a fixed built-in list.
   Permission presets now preserve the configured list in execution, capability
   projections, CLI preview/apply, and the Agent settings selector. Named task
   presets retain their selection semantics. The read-only preset also no
   longer selects the incompatible coder subagent.
3. **Opaque acquisition was not retained as measurable work.** The first
   repaired run successfully searched, but left results only in `run_command`
   output and spent additional turns discovering an image route. After 303,306 ms
   without product/acceptance progress, it received a redirect and later stopped.
   The Skill now requires evidence files and honestly completed plan steps
   between expensive searches, and bounds further acquisition to evidence gaps.
   Runtime guard thresholds and historical progress receipts are unchanged;
   this fixes the integration workflow, not semantic observability for all
   arbitrary commands.
4. **Extracted images require a different Tessmora API.** Document stream/content
   routes do not serve extracted image IDs. Added the Node launcher's
   `image fetch` extension using `/api/chat/reference-image-url`, exactly as
   Tessmora's chat UI does. It retains original bytes and source/hash receipts,
   refuses overwrites, bounds download size/time, and omits expiring signed URLs
   from receipts. The upstream Python CLI remains unchanged.
5. **Markdown file previews resolved relative images from the workspace root.**
   The shared renderer now receives the source document path and thread binding
   from both file and artifact inspectors. Images resolve relative to the
   document; normal chat rendering and external image URLs retain their behavior.

## Evidence

- Original runs: `run_40ba5bd4b6c74c249c1e` and `run_1f77825551a84b13bdc9`.
  Their effective configurations omitted `mma-rag`; the latter received
  `skill_not_enabled`. Historical runs and decisions were preserved.
- Intermediate run: `run_8400aa53da9540549150`. Skill loaded; searches succeeded
  (107,151 / 89,903 / 90,874 ms); stopped with
  `Run made no measurable progress after one reroute: elapsed.`
- Final browser-submitted run: **`run_8e7a39806c5949148a6a`**, **completed**.
  Started `2026-09-10T10:26:10.112Z`, finished `2026-09-10T10:29:14.323Z`.
  Skill loaded at event 1005. No `run.no_progress` or `run.progress.rerouted`
  event occurred. The output directory artifact is `verified`.
- Output: `/Users/champ/Projects/testNapier/outputs/thread_95954117ba3846f49fc0/申请本科成绩单-办理流程.md`.
  Contains nine procedure steps, five original images, source evidence, and
  explicit missing-page/coverage limitations. Image bytes and SHA-256 values
  match the saved image-fetch receipts.
- Browser verification after reload: all five chat images and all five
  document-preview images loaded with nonzero natural widths. Document preview
  requests include the correct thread binding and document-relative paths.
  Screenshot inspected at `/tmp/napier-tessmora-preview.png`.

## Validation

- 51 tests passed across runtime Skill overrides, HTTP message execution under
  all three permission modes, CLI configuration/execution, shared installation,
  Skill snapshots, and reference-image handling.
- 13 frontend DOM tests passed using the web package's Vite/Preact configuration:
  workspace file inspection, rich Markdown content, and workspace links.
- Contracts build; runtime/server typechecks; CLI and web typechecks/builds;
  Skill validation; formatting and `git diff --check` passed.
- Frontend proxy and backend `/api/health` both returned `ok` after verification.

Retrieval latency remains a Tessmora service characteristic: successful searches
can take minutes. The integration does not claim to improve that backend latency.
The final run reused earlier retained conversation evidence and performed a new
image retrieval; it is a same-thread recovery, not a clean-thread benchmark.
