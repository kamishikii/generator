export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
export const TAU = Math.PI * 2;

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeNoise3D(seed) {
  const rng = mulberry32(seed >>> 0);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = (rng() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t; }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  const grad = (h, x, y, z) => {
    const g = h & 15;
    const u = g < 8 ? x : y;
    const v = g < 4 ? y : (g === 12 || g === 14 ? x : z);
    return ((g & 1) ? -u : u) + ((g & 2) ? -v : v);
  };
  return function (x, y, z) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    const u = fade(x), v = fade(y), w = fade(z);
    const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z;
    const B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
    const L = (a, b, t) => a + t * (b - a);
    return L(
      L(L(grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z), u),
        L(grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z), u), v),
      L(L(grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1), u),
        L(grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1), u), v), w);
  };
}

export function fbm(n, x, y, z, oct = 4, lac = 2.03, gain = 0.5) {
  let a = 1, f = 1, s = 0, norm = 0;
  for (let i = 0; i < oct; i++) { s += a * n(x * f, y * f, z * f); norm += a; a *= gain; f *= lac; }
  return s / norm;
}

export function ridged(n, x, y, z, oct = 4, lac = 2.07, gain = 0.52) {
  let a = 1, f = 1, s = 0, norm = 0;
  for (let i = 0; i < oct; i++) { s += a * (1 - Math.abs(n(x * f, y * f, z * f))); norm += a; a *= gain; f *= lac; }
  return s / norm;
}
