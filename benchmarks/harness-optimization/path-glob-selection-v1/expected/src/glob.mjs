function parts(text, pattern) {
  if (typeof text !== "string" || !text || text.includes("\\"))
    throw new TypeError("Invalid path");
  const p = text.split("/");
  if (
    p.some(
      (s) =>
        !s ||
        s === "." ||
        s === ".." ||
        (pattern ? s !== "**" && s.includes("**") : /[*?]/.test(s)),
    )
  )
    throw new TypeError("Invalid component");
  return p;
}
function component(pattern, text) {
  const p = [...pattern],
    t = [...text],
    memo = new Map();
  function at(i, j) {
    const k = i + "," + j;
    if (memo.has(k)) return memo.get(k);
    let result;
    if (i === p.length) result = j === t.length;
    else if (p[i] === "*")
      result = at(i + 1, j) || (j < t.length && at(i, j + 1));
    else
      result =
        j < t.length && (p[i] === "?" || p[i] === t[j]) && at(i + 1, j + 1);
    memo.set(k, result);
    return result;
  }
  return at(0, 0);
}
export function matchesPath(pattern, path) {
  const p = parts(pattern, true),
    t = parts(path, false),
    memo = new Map();
  function at(i, j) {
    const key = i + "," + j;
    if (memo.has(key)) return memo.get(key);
    const result =
      i === p.length
        ? j === t.length
        : p[i] === "**"
          ? at(i + 1, j) || (j < t.length && at(i, j + 1))
          : j < t.length && component(p[i], t[j]) && at(i + 1, j + 1);
    memo.set(key, result);
    return result;
  }
  return at(0, 0);
}
