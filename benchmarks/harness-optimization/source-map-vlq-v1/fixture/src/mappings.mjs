import { decodeVlq } from "./vlq.mjs";
export function decodeMappings(text) {
  return text.split(";").flatMap((line, generatedLine) =>
    line
      .split(",")
      .filter(Boolean)
      .map((segment) => ({
        generatedLine,
        generatedColumn: decodeVlq(segment)[0],
      })),
  );
}
