import { artifactInspectorCopy as copy } from "./artifact-inspector-copy";

export const MAX_FILE_PREVIEW_LINES = 2_000;
export const MAX_FILE_PREVIEW_CHARACTERS = 200_000;

/** Bound rendering work without changing the downloadable file or receipt. */
export function limitFilePreviewText(text: string): {
  text: string;
  truncated: boolean;
} {
  let end = Math.min(text.length, MAX_FILE_PREVIEW_CHARACTERS);
  // Avoid showing half of a UTF-16 surrogate pair at the character boundary.
  if (
    end < text.length &&
    text.charCodeAt(end - 1) >= 0xd800 &&
    text.charCodeAt(end - 1) <= 0xdbff &&
    text.charCodeAt(end) >= 0xdc00 &&
    text.charCodeAt(end) <= 0xdfff
  ) {
    end -= 1;
  }
  const bounded = text.slice(0, end);
  const newlines = /\r\n|\r|\n/gu;
  let lineCount = 1;
  for (const match of bounded.matchAll(newlines)) {
    if (lineCount === MAX_FILE_PREVIEW_LINES) {
      end = match.index;
      break;
    }
    lineCount += 1;
  }
  return { text: text.slice(0, end), truncated: end < text.length };
}

export function FileSourcePreview({
  text,
  diff = false,
  truncated = false,
}: {
  text: string;
  diff?: boolean;
  truncated?: boolean;
}) {
  const preview = limitFilePreviewText(text);
  return (
    <>
      {preview.truncated || truncated ? (
        <p className="artifact-inspector-notice" role="status">
          {preview.truncated ? copy.previewTruncated : copy.textPreviewPartial}
        </p>
      ) : null}
      <ol className={`artifact-source-preview${diff ? " is-diff" : ""}`}>
        {preview.text.split(/\r\n|\r|\n/u).map((line, index) => (
          <li
            className={
              diff
                ? line.startsWith("+")
                  ? "is-added"
                  : line.startsWith("-")
                    ? "is-removed"
                    : undefined
                : undefined
            }
            key={index}
          >
            <code>{line || " "}</code>
          </li>
        ))}
      </ol>
    </>
  );
}
