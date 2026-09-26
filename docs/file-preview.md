# File previews

Workspace file previews and registered artifact previews share the same file-type
classification. Images (including SVG) and PDFs render as media, HTML uses a
directory-scoped sandbox with local assets, Markdown renders as a document, and
recognized source/data files render as text. MDX displays its Markdown content;
it does not compile or execute JSX. Office and audio/video files do not yet have
dedicated preview renderers.

## Limits and text decoding

- Workspace files, artifact file previews and HTTP artifact downloads accept up
  to **128 MiB** per file.
- The artifact JSON text-preview endpoint accepts **2 MiB**. Larger files use the
  file-preview endpoint; this avoids putting large text bodies into JSON receipts.
- The frontend decodes at most the first **2 MiB** of a large text file and renders
  at most **2,000 lines or 200,000 characters**, with a visible partial-preview
  notice. Downloads retain the original complete bytes.
- HTML's sandbox URL serves the complete document and local resources, independent
  of the source-text display limit. Images and PDFs use the original complete Blob;
  small SVG artifacts can also render from their complete text-preview receipt.
- Text supports strict UTF-8 and UTF-16 LE/BE with a BOM. Invalid encodings display
  an explanation while keeping the original file available for download.

The shared contract is `@napier/contracts/file-preview`. Its MIME map includes
`.markdown`, JSONL/NDJSON, TSV and common code formats such as Python, Go and shell.
Local SVG references also work in Markdown images.

## Artifact evidence and isolation

`GET /api/threads/:threadId/plans/:planId/artifacts/:artifactId/preview-file`
returns file bytes with artifact identity, path hash, content hash, size and a
Ledger receipt. It requires a produced/verified file artifact and checks verified
artifact digests before returning bytes. The browser independently validates the
identity, path, body hash and byte count.

The `/preview-file/peek` variant applies the same checks without appending a Ledger
event. Automatic HTML previews use peek; explicit file-preview inspection records
`artifact.previewed` with `previewKind: "file"`. Existing text-preview receipts
retain their original schema and validation.

SVG renders in an image context, preserving animation without granting script or
external-resource execution. Raw SVG responses also carry sandbox CSP for direct
navigation. HTML remains sandboxed without application-origin access. Object URLs
are revoked on replacement/unmount, and failed images can be retried by refreshing.

The runtime export helper's default verification bound and binary verification
upload endpoint remain **32 MiB**; HTTP preview/download routes explicitly select
the larger file-transfer limit.
