const HEX = /^[a-f0-9]{64}$/u;
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function exact(
  value: Record<string, unknown>,
  required: string[],
  optional: string[] = [],
): boolean {
  const actual = Object.keys(value).sort(codeUnit);
  const allowed = [...required, ...optional];
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    actual.every((key) => allowed.includes(key))
  );
}

export function codeUnit(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function integer(
  value: unknown,
  min: number,
  max: number,
): value is number {
  return Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
}

export function hex(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

export function name(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && NAME.test(value);
}

export function hashed(value: Record<string, unknown>, terminal: string): boolean {
  if (!hex(value[terminal])) return false;
  const copy = { ...value };
  delete copy[terminal];
  return sha256(canonical(copy)) === value[terminal];
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (object(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort(codeUnit)
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

// Small synchronous SHA-256 keeps this browser-safe and dependency-free.
export function sha256(text: string): string {
  const bytes = new TextEncoder().encode(text); const bitLength = bytes.length * 8;
  const paddedLength = ((bytes.length + 9 + 63) >> 6) << 6; const data = new Uint8Array(paddedLength); data.set(bytes); data[bytes.length] = 0x80;
  const view = new DataView(data.buffer); view.setUint32(paddedLength - 4, bitLength >>> 0); view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  const h = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  const k = new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
  const w = new Uint32Array(64); const r = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < data.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) { const a = w[i-15]!, b = w[i-2]!; w[i] = (w[i-16]! + (r(a,7)^r(a,18)^(a>>>3)) + w[i-7]! + (r(b,17)^r(b,19)^(b>>>10))) >>> 0; }
    let [a,b,c,d,e,f,g,q] = h;
    for (let i = 0; i < 64; i++) { const t1 = (q! + (r(e!,6)^r(e!,11)^r(e!,25)) + ((e!&f!)^(~e!&g!)) + k[i]! + w[i]!) >>> 0; const t2 = ((r(a!,2)^r(a!,13)^r(a!,22)) + ((a!&b!)^(a!&c!)^(b!&c!))) >>> 0; q=g; g=f; f=e; e=(d!+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0; }
    [a,b,c,d,e,f,g,q].forEach((value, i) => { h[i] = (h[i]! + value!) >>> 0; });
  }
  return [...h].map((value) => value.toString(16).padStart(8, "0")).join("");
}
