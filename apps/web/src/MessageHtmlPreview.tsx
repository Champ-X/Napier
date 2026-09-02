import { Code2, PanelTop } from "lucide-react";

import { highlightMessageCode } from "./message-code-highlighting";

export function MessageHtmlPreview({ source }: { source: string }) {
  const highlighted = highlightMessageCode(source, "html") ?? [
    { value: source },
  ];
  return (
    <section
      className="message-html-preview"
      aria-label="Sandboxed HTML preview"
    >
      <header>
        <span>
          <PanelTop size={13} aria-hidden="true" /> HTML preview
        </span>
        <small>scripts and network disabled</small>
      </header>
      <iframe
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={inertHtmlDocument(source)}
        title="Sandboxed HTML preview from the answer"
      />
      <details>
        <summary>
          <Code2 size={13} aria-hidden="true" /> Source
        </summary>
        <pre className="message-code-block language-html">
          <code>
            {highlighted.map((token, index) =>
              token.tone ? (
                <span
                  className={`message-code-token is-${token.tone}`}
                  key={String(index)}
                >
                  {token.value}
                </span>
              ) : (
                token.value
              ),
            )}
          </code>
        </pre>
      </details>
    </section>
  );
}

export function inertHtmlDocument(source: string): string {
  const policy = [
    "default-src 'none'",
    "img-src data: blob:",
    "font-src data:",
    "style-src 'unsafe-inline'",
    "script-src 'none'",
    "connect-src 'none'",
    "media-src data: blob:",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  const boundary = `<meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer"><style>html{color-scheme:light;font:14px/1.5 system-ui,sans-serif;background:#fff;color:#1f1e1b}body{margin:18px;overflow-wrap:anywhere}img{max-width:100%;height:auto}button,input,select,textarea{font:inherit}</style>`;
  const inert = source
    .replace(/<(script|iframe|object)\b[^>]*>[\s\S]*?<\/\1\s*>\s*/giu, "")
    .replace(/<(?:script|iframe|object|embed|base|link|meta)\b[^>]*\/?>/giu, "")
    .replace(/\s+on[a-z][\w:-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/giu, "")
    .replace(
      /\s+(?:action|formaction|(?:xlink:)?href|ping|poster|srcdoc|srcset)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/giu,
      "",
    )
    .replace(
      /\s+src\s*=\s*(?!["']?data:image\/)(?:"[^"]*"|'[^']*'|[^\s>]+)/giu,
      "",
    );
  return /<head(?:\s[^>]*)?>/iu.test(inert)
    ? inert.replace(/<head((?:\s[^>]*)?)>/iu, `<head$1>${boundary}`)
    : /<html(?:\s[^>]*)?>/iu.test(inert)
      ? inert.replace(
          /<html((?:\s[^>]*)?)>/iu,
          `<html$1><head>${boundary}</head>`,
        )
      : `<!doctype html><html><head>${boundary}</head><body>${inert}</body></html>`;
}
