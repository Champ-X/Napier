export function cloneJson(value) {
  const ancestors = new Set();
  const copy = (x) => {
    if (x === null || typeof x === "string" || typeof x === "boolean") return x;
    if (typeof x === "number" && Number.isFinite(x)) return x;
    if (typeof x !== "object" || x === null || ancestors.has(x))
      throw new TypeError("Invalid JSON");
    const array = Array.isArray(x);
    if (
      !array &&
      Object.getPrototypeOf(x) !== Object.prototype &&
      Object.getPrototypeOf(x) !== null
    )
      throw new TypeError("Invalid object");
    ancestors.add(x);
    const out = array ? [] : {};
    if (array) {
      for (let i = 0; i < x.length; i++) {
        if (!Object.hasOwn(x, i)) throw new TypeError("Sparse array");
        out.push(copy(x[i]));
      }
    } else
      for (const key of Object.keys(x))
        Object.defineProperty(out, key, {
          value: copy(x[key]),
          enumerable: true,
          writable: true,
          configurable: true,
        });
    ancestors.delete(x);
    return out;
  };
  return copy(value);
}
