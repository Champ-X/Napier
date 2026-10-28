/** Explicit references are hints, never verification. Consumers must bind them
 * to declared artifacts or independently check provenance and workspace access. */
export function taskDeliverableReferences(text: string): string[] {
  const refs: string[] = [];
  for (const match of text.matchAll(
    /\[[^\]\n]*\]\((?:<([^>\n]+)>|([^\s)]+))\)|`([^`\n]+)`/gu,
  )) {
    const value = match[1] ?? match[2] ?? match[3] ?? "";
    if (
      value.length > 500 ||
      !/[/\\.]|^https?:/u.test(value) ||
      /[\x00-\x1f]/u.test(value)
    )
      continue;
    refs.push(value);
    if (refs.length >= 30) break;
  }
  return [...new Set(refs)];
}
