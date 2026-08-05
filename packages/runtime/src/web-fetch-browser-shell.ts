const PASSWORD_INPUT =
  /<input\b[^>]*\btype\s*=\s*(?:"password"|'password'|password)(?:\s|\/?>)/iu;
const DOCUMENT_WRITE = /\bdocument\.(?:write|writeln)\s*\(/iu;
const SCRIPT = /<script\b([^>]*)>/giu;
const EMPTY_APP_MOUNT =
  /<(div|main|section)\b(?=[^>]*\bid\s*=\s*(["'])(?:root|app|application|__next|__nuxt)\2)[^>]*>\s*(?:<!--[\s\S]*?-->\s*)*<\/\1\s*>/iu;
const APP_SCRIPT_PATH =
  /(?:^|[/._-])(?:app|bundle|client|entry|index|main|runtime)(?:[/._-]|$)/iu;

export function hasConservativeBrowserShell(html: string): boolean {
  if (PASSWORD_INPUT.test(html) || !/<script\b/iu.test(html)) return false;
  if (DOCUMENT_WRITE.test(html)) return true;
  if (!EMPTY_APP_MOUNT.test(html)) return false;
  return [...html.matchAll(SCRIPT)].some((match) =>
    executableAppScript(match[1] ?? ""),
  );
}

function executableAppScript(attributes: string): boolean {
  const source = attribute(attributes, "src");
  if (!source) return false;
  const type = attribute(attributes, "type")?.toLowerCase();
  if (
    type &&
    type !== "module" &&
    type !== "text/javascript" &&
    type !== "application/javascript"
  ) {
    return false;
  }
  return type === "module" || APP_SCRIPT_PATH.test(safePath(source));
}

function attribute(attributes: string, name: string): string | undefined {
  const match = new RegExp(
    `\\b${name}\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s\"'=<>]+))`,
    "iu",
  ).exec(attributes);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function safePath(value: string): string {
  try {
    return new URL(value, "https://browser-shell.invalid/").pathname;
  } catch {
    return "";
  }
}
