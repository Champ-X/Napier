export type MessageCodeTokenTone =
  | "comment"
  | "keyword"
  | "literal"
  | "number"
  | "property"
  | "string"
  | "tag";

export interface MessageCodeToken {
  value: string;
  tone?: MessageCodeTokenTone;
}

const JAVASCRIPT_LANGUAGES = new Set([
  "js",
  "jsx",
  "javascript",
  "ts",
  "tsx",
  "typescript",
]);
const SHELL_LANGUAGES = new Set(["bash", "sh", "shell", "zsh"]);
const PYTHON_LANGUAGES = new Set(["py", "python"]);
const MARKUP_LANGUAGES = new Set(["html", "xml"]);
const JAVASCRIPT_KEYWORDS = new Set([
  "as",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "default",
  "delete",
  "do",
  "else",
  "export",
  "extends",
  "finally",
  "for",
  "from",
  "function",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "of",
  "private",
  "protected",
  "public",
  "return",
  "static",
  "switch",
  "throw",
  "try",
  "type",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);
const PYTHON_KEYWORDS = new Set([
  "and",
  "as",
  "assert",
  "async",
  "await",
  "break",
  "class",
  "continue",
  "def",
  "del",
  "elif",
  "else",
  "except",
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "nonlocal",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "try",
  "while",
  "with",
  "yield",
]);
const LITERALS = new Set([
  "false",
  "null",
  "true",
  "undefined",
  "False",
  "None",
  "True",
]);

export function highlightMessageCode(
  value: string,
  language: string | undefined,
): MessageCodeToken[] | undefined {
  if (!language) return undefined;
  if (JAVASCRIPT_LANGUAGES.has(language)) {
    return highlightGeneralCode(value, JAVASCRIPT_KEYWORDS, {
      lineComment: "//",
      blockComments: true,
      templateStrings: true,
    });
  }
  if (language === "json" || language === "jsonc") {
    return highlightJson(value, language === "jsonc");
  }
  if (SHELL_LANGUAGES.has(language)) {
    return highlightGeneralCode(value, SHELL_KEYWORDS, {
      lineComment: "#",
      blockComments: false,
      templateStrings: false,
    });
  }
  if (PYTHON_LANGUAGES.has(language)) {
    return highlightGeneralCode(value, PYTHON_KEYWORDS, {
      lineComment: "#",
      blockComments: false,
      templateStrings: false,
    });
  }
  if (language === "css") return highlightCss(value);
  if (MARKUP_LANGUAGES.has(language)) return highlightMarkup(value);
  return undefined;
}

const SHELL_KEYWORDS = new Set([
  "case",
  "do",
  "done",
  "elif",
  "else",
  "esac",
  "fi",
  "for",
  "function",
  "if",
  "in",
  "select",
  "then",
  "until",
  "while",
]);

function highlightGeneralCode(
  value: string,
  keywords: ReadonlySet<string>,
  options: {
    lineComment: string;
    blockComments: boolean;
    templateStrings: boolean;
  },
): MessageCodeToken[] {
  const tokens: MessageCodeToken[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    const rest = value.slice(cursor);
    const lineComment = rest.startsWith(options.lineComment);
    if (lineComment) {
      const end = value.indexOf("\n", cursor);
      cursor = pushToken(
        tokens,
        value,
        cursor,
        end === -1 ? value.length : end,
        "comment",
      );
      continue;
    }
    if (options.blockComments && rest.startsWith("/*")) {
      const end = value.indexOf("*/", cursor + 2);
      cursor = pushToken(
        tokens,
        value,
        cursor,
        end === -1 ? value.length : end + 2,
        "comment",
      );
      continue;
    }
    const quote = value[cursor];
    if (
      quote === "'" ||
      quote === '"' ||
      (options.templateStrings && quote === "`")
    ) {
      cursor = scanQuoted(tokens, value, cursor, quote);
      continue;
    }
    const number = rest.match(/^(?:0[xX][\da-fA-F]+|\d+(?:\.\d+)?)/u);
    if (number) {
      cursor = pushToken(
        tokens,
        value,
        cursor,
        cursor + number[0].length,
        "number",
      );
      continue;
    }
    const identifier = rest.match(/^[A-Za-z_$][A-Za-z0-9_$]*/u);
    if (identifier) {
      const word = identifier[0];
      cursor = pushToken(
        tokens,
        value,
        cursor,
        cursor + word.length,
        keywords.has(word)
          ? "keyword"
          : LITERALS.has(word)
            ? "literal"
            : undefined,
      );
      continue;
    }
    cursor = pushToken(tokens, value, cursor, cursor + 1);
  }
  return mergePlainTokens(tokens);
}

function highlightJson(value: string, commentsAllowed: boolean): MessageCodeToken[] {
  const tokens: MessageCodeToken[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    const rest = value.slice(cursor);
    if (commentsAllowed && (rest.startsWith("//") || rest.startsWith("/*"))) {
      const lineEnd = value.indexOf("\n", cursor);
      const blockEnd = value.indexOf("*/", cursor + 2);
      const end = rest.startsWith("//")
        ? lineEnd === -1
          ? value.length
          : lineEnd
        : blockEnd === -1
          ? value.length
          : blockEnd + 2;
      cursor = pushToken(tokens, value, cursor, end, "comment");
      continue;
    }
    if (value[cursor] === '"') {
      const start = cursor;
      cursor = quotedEnd(value, cursor, '"');
      const next = value.slice(cursor).match(/^\s*:/u);
      tokens.push({
        value: value.slice(start, cursor),
        tone: next ? "property" : "string",
      });
      continue;
    }
    const literal = rest.match(/^(?:true|false|null)\b/u);
    if (literal) {
      cursor = pushToken(
        tokens,
        value,
        cursor,
        cursor + literal[0].length,
        "literal",
      );
      continue;
    }
    const number = rest.match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/u);
    if (number) {
      cursor = pushToken(
        tokens,
        value,
        cursor,
        cursor + number[0].length,
        "number",
      );
      continue;
    }
    cursor = pushToken(tokens, value, cursor, cursor + 1);
  }
  return mergePlainTokens(tokens);
}

function highlightCss(value: string): MessageCodeToken[] {
  const pattern =
    /(\/\*[\s\S]*?(?:\*\/|$)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|#[\da-fA-F]{3,8}\b|-?\d+(?:\.\d+)?(?:px|rem|em|vh|vw|%|s|ms)?\b|[A-Za-z_-][\w-]*(?=\s*:))/gu;
  return tokenizePattern(value, pattern, (token) =>
    token.startsWith("/*")
      ? "comment"
      : token.startsWith('"') || token.startsWith("'")
        ? "string"
        : /^[A-Za-z_-]/u.test(token)
          ? "property"
          : "number",
  );
}

function highlightMarkup(value: string): MessageCodeToken[] {
  const pattern =
    /(<!--[\s\S]*?(?:-->|$)|<\/?[A-Za-z][^<>]*?>|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/gu;
  return tokenizePattern(value, pattern, (token) =>
    token.startsWith("<!--")
      ? "comment"
      : token.startsWith("<")
        ? "tag"
        : "string",
  );
}

function tokenizePattern(
  value: string,
  pattern: RegExp,
  tone: (token: string) => MessageCodeTokenTone,
): MessageCodeToken[] {
  const tokens: MessageCodeToken[] = [];
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const start = match.index;
    if (start > cursor) tokens.push({ value: value.slice(cursor, start) });
    tokens.push({ value: match[0], tone: tone(match[0]) });
    cursor = start + match[0].length;
  }
  if (cursor < value.length) tokens.push({ value: value.slice(cursor) });
  return tokens;
}

function scanQuoted(
  tokens: MessageCodeToken[],
  value: string,
  start: number,
  quote: string,
): number {
  const end = quotedEnd(value, start, quote);
  tokens.push({ value: value.slice(start, end), tone: "string" });
  return end;
}

function quotedEnd(value: string, start: number, quote: string): number {
  let cursor = start + 1;
  while (cursor < value.length) {
    if (value[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    cursor += 1;
    if (value[cursor - 1] === quote) break;
  }
  return Math.min(cursor, value.length);
}

function pushToken(
  tokens: MessageCodeToken[],
  value: string,
  start: number,
  end: number,
  tone?: MessageCodeTokenTone,
): number {
  tokens.push({
    value: value.slice(start, end),
    ...(tone ? { tone } : {}),
  });
  return end;
}

function mergePlainTokens(tokens: MessageCodeToken[]): MessageCodeToken[] {
  const output: MessageCodeToken[] = [];
  for (const token of tokens) {
    const previous = output.at(-1);
    if (!token.tone && previous && !previous.tone) {
      previous.value += token.value;
    } else {
      output.push({ ...token });
    }
  }
  return output;
}
