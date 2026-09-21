export function mergeConfig(base, layer) {
  for (const [key, value] of Object.entries(layer)) {
    base[key] = value || base[key];
  }
  return base;
}
