import { decodePointer } from "./pointer.mjs";
const own = (o, k) => Object.hasOwn(o, k),
  fail = () => {
    throw new TypeError("Invalid patch");
  };
const clone = (x) => JSON.parse(JSON.stringify(x));
const equal = (a, b) => {
  if (a === b) return true;
  if (
    !a ||
    !b ||
    typeof a !== "object" ||
    typeof b !== "object" ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((k) => own(b, k) && equal(a[k], b[k]))
  );
};
function index(array, key, adding) {
  if (adding && key === "-") return array.length;
  if (!/^(0|[1-9][0-9]*)$/.test(key)) return fail();
  const n = Number(key);
  if (
    !Number.isSafeInteger(n) ||
    n > array.length ||
    (!adding && n === array.length)
  )
    return fail();
  return n;
}
const container = (x) => {
  if (!x || typeof x !== "object") fail();
  return x;
};
function get(root, keys) {
  let obj = root;
  for (const key of keys) {
    container(obj);
    const k = Array.isArray(obj) ? index(obj, key, false) : key;
    if (!own(obj, k)) fail();
    obj = obj[k];
  }
  return obj;
}
function modify(root, keys, mode, value) {
  if (!keys.length) {
    if (mode === "remove") fail();
    return clone(value);
  }
  const parent = container(get(root, keys.slice(0, -1))),
    last = keys.at(-1),
    key = Array.isArray(parent) ? index(parent, last, mode === "add") : last;
  if (mode !== "add" && !own(parent, key)) fail();
  if (Array.isArray(parent)) {
    if (mode === "add") parent.splice(key, 0, clone(value));
    else if (mode === "remove") parent.splice(key, 1);
    else parent[key] = clone(value);
  } else if (mode === "remove") delete parent[key];
  else
    Object.defineProperty(parent, key, {
      value: clone(value),
      writable: true,
      configurable: true,
      enumerable: true,
    });
  return root;
}
export function applyPatch(document, operations) {
  if (!Array.isArray(operations)) fail();
  let result = clone(document);
  for (let i = 0; i < operations.length; i++) {
    if (!own(operations, i)) fail();
    const op = operations[i];
    if (!op || typeof op !== "object" || Array.isArray(op)) fail();
    const dest = decodePointer(op.path);
    if (["add", "replace", "test"].includes(op.op)) {
      if (!own(op, "value")) fail();
      if (op.op === "test") {
        if (!equal(get(result, dest), op.value)) fail();
      } else result = modify(result, dest, op.op, op.value);
    } else if (op.op === "remove") result = modify(result, dest, "remove");
    else if (op.op === "copy" || op.op === "move") {
      const from = decodePointer(op.from),
        value = clone(get(result, from));
      if (op.op === "move") {
        if (dest.length > from.length && from.every((k, j) => k === dest[j]))
          fail();
        if (dest.length === from.length && from.every((k, j) => k === dest[j]))
          continue;
        result = modify(result, from, "remove");
      }
      result = modify(result, dest, "add", value);
    } else fail();
  }
  return result;
}
