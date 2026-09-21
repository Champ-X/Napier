import { decodePointer } from "./pointer.mjs";
export function applyPatch(document, operations) {
  for (const op of operations) {
    const keys = decodePointer(op.path);
    let obj = document;
    for (const k of keys.slice(0, -1)) obj = obj[k];
    if (op.op === "remove") delete obj[keys.at(-1)];
    else obj[keys.at(-1)] = op.value;
  }
  return document;
}
