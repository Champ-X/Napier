---
name: mma-rag
description: Operate the locally running Tessmora knowledge service through its bundled deterministic mma-rag CLI. Use when Napier needs to list or create Tessmora knowledge bases, inspect indexed files, upload and index local documents/images/audio/video, wait for ingestion, retrieve compact multimodal evidence, or answer questions grounded in Tessmora.
---

# Tessmora (`mma-rag` CLI)

Use the bundled `scripts/mma-rag` CLI. The command and environment-variable prefix retain the `mma-rag` name for compatibility after the product rename to Tessmora. Resolve the script relative to this `SKILL.md`, invoke it by absolute path, and expect JSON on stdout for every command.

## Running in Napier

Install this Skill using `node scripts/install-tessmora-skill.mjs` from the
Napier application checkout. The installer places it in the shared user Skill
directory and resolves the launcher path below. Enable `mma-rag` on the Agent
in each workspace where it is needed. Skill files are shared across workspaces;
Agent selections are stored separately in each workspace's `.napier` ledger.
Napier's `/user/` Skill paths are virtual, not executable filesystem paths.
Python 3 must be on the process PATH.
The execution provider must be able to reach Tessmora; the existing local
host-direct configuration supports this. An offline container cannot reach the
host service at its own `127.0.0.1`.

Use `run_command` with the included Node launcher. It forwards literal arguments
to the upstream Python CLI, waits for completion, and preserves JSON and exit
codes. For example:

```json
{
  "runtime": "node",
  "args": ["__TESSMORA_CLI__", "health"],
  "timeoutMs": 30000
}
```

Replace `health` with CLI arguments such as `"kb","list"` or
`"search","--query","QUESTION","--kb-id","KB_ID","--top-k","3"`.
For retrieval and grounded answers, use `timeoutMs: 600000` to accommodate the
CLI's 360-second request timeout. Read command flags through
`skill_resource` with `name: "mma-rag"` and
`path: "references/cli-reference.md"`.
Napier does not inherit arbitrary server environment variables into commands;
use the CLI's `--base-url` option before the command for a different endpoint.

The upstream Skill and Python CLI come from `Champ-X/MMA-RAG` commit
`df10c1d5b4e066ccd6a986708ffa95d7c27186da`; only these Napier instructions and
the Node launcher (including `image fetch`) are local adaptations.

## Workflow

1. Run `scripts/mma-rag health` before the first operation.
2. If the service is unavailable, report that Tessmora must be started. Do not start or stop it unless the user asks.
3. Run `kb list` when the target knowledge base ID is unknown.
4. Use `ingest files` with absolute paths to add local multimodal files.
5. Save every returned `processing_id` and run `ingest wait` or `ingest status`.
6. Treat content as searchable only after every relevant job reports `completed`.
7. Use `search` when the user wants evidence or when Napier will synthesize the result.
8. Use `ask` when the user explicitly wants Tessmora to generate the grounded answer.
9. Preserve returned file names, page numbers, and audio/video time ranges in the final response.

## Evidence checkpoints and original images

`run_command` output alone is opaque to Napier's progress tracker. After a
successful retrieval, use `apply_patch` to retain the relevant evidence and
source metadata in a workspace Markdown/JSON file before another expensive
search. Inspect the evidence and complete only the plan steps whose acceptance
criteria are actually met. Do not merely relabel unfinished work as completed.
Query again only for a specific remaining evidence gap; once the evidence is
sufficient, synthesize the answer. If retrieval fails, preserve the error and
report the limitation rather than repeating the same request indefinitely.

For original illustrations, use the Node launcher's `image fetch` extension
described in the CLI reference. Pass the image hit's own `source.knowledge_base_id`
and `source.file_path` verbatim (they can differ from catalog IDs). Never guess
document `/content` or `/stream` URLs for extracted images. Save downloads beside
the answer, retain the returned source and SHA-256 in the evidence file, and
reference the local image from Markdown. A null source page is unknown; do not
invent a page number. If images are unavailable, deliver the supported text
answer with that limitation.

## Safety

- Create knowledge bases or upload files only when the user's request authorizes the mutation.
- Never delete or overwrite Tessmora content; this skill exposes no deletion command.
- Upload only user-designated files. The CLI rejects files outside configured safe roots and common credential paths.
- Do not claim ingestion succeeded when a job is queued, processing, failed, missing, or timed out.
- Do not expose raw CLI diagnostics or secrets in the final response.

## Command details

Read [references/cli-reference.md](references/cli-reference.md) when selecting flags, handling errors, filtering by files/modalities, or configuring safe upload roots.
