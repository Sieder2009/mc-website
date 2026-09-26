// Tiny seeded PRNG so procedural assets (trees, paving, petals) are
// deterministic per seed — the same seed always grows the same tree, in
// dev and in production.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Convenience helpers built on top of a `next()` function.
export const range = (next, min, max) => min + next() * (max - min);
export const pickOne = (next, list) => list[Math.floor(next() * list.length)];
export const sign = (next) => (next() < 0.5 ? -1 : 1);

// Smooth 2D value noise (0..1) for canvas textures — seedable, no deps.
export function makeNoise2D(seed = 1) {
  const next = mulberry32(seed);
  const size = 256;
  const grid = new Float32Array(size * size);
  for (let i = 0; i < grid.length; i++) grid[i] = next();
  const at = (x, y) => grid[((y & 255) << 8) | (x & 255)];
  const fade = (t) => t * t * (3 - 2 * t);
  return function noise(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = fade(x - xi);
    const yf = fade(y - yi);
    const a = at(xi, yi);
    const b = at(xi + 1, yi);
    const c = at(xi, yi + 1);
    const d = at(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
}

// Fractal sum of the above (0..~1).
export function fbm(noise, x, y, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}
