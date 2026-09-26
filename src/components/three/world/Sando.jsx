// Sando — the processional path (sando) AND the ground of the whole world.
//
// Everything that has to survive grazing angles is analytic in the fragment shader, so nothing
// aliases or shimmers and nothing tiles visibly:
//  - paving: ~1000 instanced flat cells (running-bond layout planned in JS); the dark joint,
//    rounded arris (normal tilt), chipped edges / broken corners, granite grain, rain streaks,
//    moss creeping in from the joints and a few fallen petals are computed per pixel with
//    derivative-filtered coverage, so joints fade out gracefully towards the vanishing point;
//  - raked gravel: rake ridges as a filtered normal perturbation over pebble texture;
//  - verges: moss-garden terrain coloured from four macro noise fields (54 m .. 3 m) + fine
//    stroke texture (anisotropic), damp earth at the kerb foot, sparse petals everywhere and
//    dense petal drifts along the kerb and under the tree ranks;
//  - geometry: kerb stones, 9 tōrō, mossy garden stones (one merged mesh), instanced fallen
//    petals, instanced grass clumps coloured by the same ground palette, soft lantern shadows.
// 7 draw calls, ~52k triangles, 4 procedural textures (grain 512, gravel 512, ground 1024, macro 256).
//
// Units: 1 unit = 1 m, Y up, the path runs along Z (walker goes -Z), centreline x = 0.
import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { mulberry32, range, makeNoise2D, fbm } from "./rng.js";
import { WORLD } from "./WorldEnvironment.jsx";

export const PATH = {
  halfWidth: 1.7,
  zStart: 12,
  zEnd: -140,
  lanternSpacing: 16,
  lanternX: 4.6,
  lanternZ0: -12,
};

// Exact lantern (tōrō) positions: alternating sides, first one on the left (x < 0).
export const LANTERNS = Array.from({ length: 9 }, (_, i) => ({
  x: (i % 2 === 0 ? -1 : 1) * PATH.lanternX,
  z: PATH.lanternZ0 - i * PATH.lanternSpacing,
}));

/* ------------------------------------------------------------------ */
/* small maths                                                          */
/* ------------------------------------------------------------------ */
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;
const mixRGB = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const hash3 = (x, y, z, s = 0) => {
  const v = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + s * 4.581) * 43758.5453;
  return v - Math.floor(v);
};

// Under the shared WorldEnvironment (sun 2.2 + hemisphere 1.05, physical light units) a
// sun-lit up-facing surface renders at roughly 0.66 x its albedo. `alb` takes the colour we
// WANT to see on screen (sRGB hex) and returns the linear albedo that produces it.
const E_UP = 0.66;
const _c = new THREE.Color();
const alb = (hex, k = 1) => {
  _c.set(hex);
  return [Math.min(1, (_c.r * k) / E_UP), Math.min(1, (_c.g * k) / E_UP), Math.min(1, (_c.b * k) / E_UP)];
};

// horizontal direction the sun's shadows fall towards
const _sun = new THREE.Vector3(...WORLD.sunDir).normalize();
const _sh = Math.hypot(_sun.x, _sun.z);
const SHADOW_DIR = [-_sun.x / _sh, -_sun.z / _sh];
const SHADOW_STRETCH = _sh / _sun.y; // metres of shadow per metre of height

/* ------------------------------------------------------------------ */
/* the terrain function shared by everything that sits on the ground     */
/* ------------------------------------------------------------------ */
const gN1 = makeNoise2D(1337);
const gN2 = makeNoise2D(4242);
const gN3 = makeNoise2D(9001);
const gN4 = makeNoise2D(77);

const KERB_IN = 3.1; // gravel ends / kerb starts
const KERB_OUT = 3.3; // kerb ends / verge starts
const GRAVEL_Y = 0.012;
const hPave = (x) => 0.03 + 0.03 * (1 - (x / PATH.halfWidth) ** 2); // slightly cambered

/** Ground height of the verge / terrain at (x, z). The path itself is flat & cambered. */
export function groundHeightAt(x, z) {
  const ax = Math.abs(x);
  if (ax < PATH.halfWidth) return hPave(x);
  if (ax < KERB_IN) return GRAVEL_Y;
  const base = 0.055 + 0.03 * smooth(3.3, 10, ax);
  const mound = smooth(5, 18, ax) * 0.55 + smooth(18, 70, ax) * 1.7;
  const n = fbm(gN1, x * 0.05 + 40, z * 0.05 + 17, 4) - 0.5;
  return Math.max(0.02, base + mound * n);
}

/* ------------------------------------------------------------------ */
/* procedural textures (tileable, built in code)                        */
/* ------------------------------------------------------------------ */
function tileNoise(seed, px, py = px) {
  const r = mulberry32(seed);
  const g = new Float32Array(px * py);
  for (let i = 0; i < g.length; i++) g[i] = r();
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const x0 = ((xi % px) + px) % px;
    const y0 = ((yi % py) + py) % py;
    const x1 = (x0 + 1) % px;
    const y1 = (y0 + 1) % py;
    const a = g[y0 * px + x0];
    const b = g[y0 * px + x1];
    const c = g[y1 * px + x0];
    const d = g[y1 * px + x1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

// fbm over the unit torus (u, v in 0..1) -> ~0..1, contrast-stretched
function tileFbm(seed, px, py, octaves = 4, stretch = 1.8) {
  const layers = [];
  let norm = 0;
  for (let k = 0; k < octaves; k++) {
    const a = 0.5 ** k;
    layers.push({ f: tileNoise(seed + k * 131, px << k, py << k), sx: px << k, sy: py << k, a });
    norm += a;
  }
  return (u, v) => {
    let s = 0;
    for (const l of layers) s += l.f(u * l.sx, v * l.sy) * l.a;
    return clamp01((s / norm - 0.5) * stretch + 0.5);
  };
}

const byte = (v) => (v <= 0 ? 0 : v >= 255 ? 255 : v | 0);

function makeTexture(data, w, h, aniso) {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

// Granite grain: R = fine speckle multiplier/2 (mean .5 -> x1), G = mid blotches,
// B = low blotches, A = moss noise. One tile = 1 m.
function makeGrainTexture(aniso) {
  const S = 512;
  const data = new Uint8Array(S * S * 4);
  const r = mulberry32(11);
  const n1 = tileNoise(21, 128);
  const n2 = tileNoise(22, 256);
  const nMid = tileFbm(31, 16, 16, 3);
  const nLow = tileFbm(41, 3, 3, 3);
  const nMoss = tileFbm(51, 8, 8, 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      let sp = 0.5 + (n1(u * 128, v * 128) - 0.5) * 0.5 + (n2(u * 256, v * 256) - 0.5) * 0.55 + (r() - 0.5) * 0.3;
      const q = r();
      if (q < 0.01) sp -= 0.3; // dark mica
      else if (q > 0.992) sp += 0.22; // pale quartz
      const i = (y * S + x) * 4;
      data[i] = byte((1 + (sp - 0.5) * 0.85) * 127.5);
      data[i + 1] = byte(nMid(u, v) * 255);
      data[i + 2] = byte(nLow(u, v) * 255);
      data[i + 3] = byte(nMoss(u, v) * 255);
    }
  }
  return makeTexture(data, S, S, aniso);
}

// Gravel pebbles: 1 m tile, 512 px. RGB = albedo multiplier / 2 (mean ~0.5 -> x1).
// Individually shaded round pebbles (lit from the upper left) with dark gaps between them.
function makeGravelTexture(aniso) {
  const S = 512;
  const r = mulberry32(77);
  const lum = new Float32Array(S * S).fill(0.5);
  const tr = new Float32Array(S * S).fill(1);
  const tb = new Float32Array(S * S).fill(1);
  const wrap = (v) => ((v % S) + S) % S;
  const N = 11000;
  for (let n = 0; n < N; n++) {
    const cx = r() * S;
    const cy = r() * S;
    const rad = 1.4 + r() * r() * 3.4;
    // pebble colour: mostly pale warm quartz-granite, some grey, a few tan / dark
    const q = r();
    let base = 0.9 + r() * 0.3;
    let kr = 1;
    let kb = 1;
    if (q < 0.08) {
      base *= 0.66;
      kr = 0.97;
      kb = 1.03;
    } else if (q < 0.2) {
      kr = 1.05;
      kb = 0.9;
    } else if (q < 0.3) {
      kr = 0.97;
      kb = 1.05;
    } else if (q > 0.965) {
      base *= 1.14;
    }
    const R = Math.ceil(rad) + 1;
    const ix = Math.floor(cx);
    const iy = Math.floor(cy);
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const ux = ix + dx + 0.5 - cx;
        const uy = iy + dy + 0.5 - cy;
        const d = Math.hypot(ux, uy) / rad;
        if (d >= 1.15) continue;
        const cov = clamp01((1 - d) * rad + 0.5);
        if (cov <= 0) continue;
        // dome shading, light from the upper left
        const nx = ux / rad;
        const ny = uy / rad;
        const shade = 1 + 0.42 * (-(nx * 0.55 + ny * 0.6)) - 0.3 * smooth(0.55, 1, d);
        const v = base * shade;
        const i = wrap(iy + dy) * S + wrap(ix + dx);
        lum[i] += (v * 0.5 - lum[i]) * cov;
        tr[i] += (kr - tr[i]) * cov;
        tb[i] += (kb - tb[i]) * cov;
      }
    }
  }
  const data = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    const L = lum[i];
    data[i * 4] = byte(L * tr[i] * 255);
    data[i * 4 + 1] = byte(L * 255);
    data[i * 4 + 2] = byte(L * tb[i] * 255);
    data[i * 4 + 3] = 255;
  }
  return makeTexture(data, S, S, aniso);
}

// soft anti-aliased sakura petal (egg shape, notch at the wide end) drawn into a wrapping mask
function drawPetal(mask, S, cx, cy, ang, L) {
  const a = L * 0.5;
  const b = L * 0.31;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const R = Math.ceil(L * 0.62) + 1;
  const ix = Math.floor(cx);
  const iy = Math.floor(cy);
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const px = ix + dx + 0.5 - cx;
      const py = iy + dy + 0.5 - cy;
      const u = px * ca + py * sa;
      const v = -px * sa + py * ca;
      const t = u / a;
      if (t <= -1 || t >= 1) continue;
      const hw = b * Math.sqrt(1 - t * t) * (1 + 0.28 * t);
      let edge = hw - Math.abs(v);
      if (t > 0.7) edge = Math.min(edge, (Math.abs(v) - (t - 0.7) * a * 0.55) * 1.0 + 0.0);
      const cov = clamp01(edge + 0.5);
      if (cov <= 0) continue;
      const x = (((ix + dx) % S) + S) % S;
      const y = (((iy + dy) % S) + S) % S;
      const i = y * S + x;
      if (cov > mask[i]) mask[i] = cov;
    }
  }
}

// Ground detail, tile 2 m, 1024 px. R = luminance/2, G = warmth (0.5 neutral),
// B = sparse fallen petals (everywhere), A = dense petal drifts (weighted in the shader).
function makeGroundTexture(aniso) {
  const S = 1024;
  const r = mulberry32(303);
  const lum = new Float32Array(S * S);
  const warm = new Float32Array(S * S);
  const nF = tileNoise(304, 64);
  const nG = tileNoise(306, 256);
  const nB = tileNoise(307, 32);
  const nC = tileNoise(308, 8); // 25 cm clumps
  const nD = tileNoise(309, 20); // 10 cm tussocks
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      lum[i] =
        1 +
        (nF(x / 16, y / 16) - 0.5) * 0.3 +
        (nG(x / 4, y / 4) - 0.5) * 0.22 +
        (nB(x / 32, y / 32) - 0.5) * 0.16 +
        (nC(x / 128, y / 128) - 0.5) * 0.3 +
        (nD(x / 51.2, y / 51.2) - 0.5) * 0.26 +
        (r() - 0.5) * 0.14;
      warm[i] = (nB(x / 32 + 9, y / 32 + 5) - 0.5) * 0.8;
    }
  }
  // blades seen from above: short strokes (moss-like carpet) plus longer grass strokes
  const strokeSets = [
    { n: 60000, l0: 3, l1: 9 },
    { n: 16000, l0: 10, l1: 26 },
  ];
  for (const set of strokeSets) {
    for (let s = 0; s < set.n; s++) {
      const x = r() * S;
      const y = r() * S;
      const ang = r() * Math.PI * 2;
      const len = set.l0 + r() * (set.l1 - set.l0);
      const q = r();
      const light = q < 0.48;
      const targetL = light ? 1.36 : q < 0.9 ? 0.66 : 0.5;
      const targetW = light ? 0.75 : -0.55;
      const al = 0.3 + r() * 0.3;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      for (let t = 0; t < len; t += 0.7) {
        const px = (Math.floor(x + ca * t) + S * 4) % S;
        const py = (Math.floor(y + sa * t) + S * 4) % S;
        const i = py * S + px;
        const fade = al * (1 - t / len);
        lum[i] += (targetL - lum[i]) * fade;
        warm[i] += (targetW - warm[i]) * fade;
      }
    }
  }
  // petals
  const sparse = new Float32Array(S * S);
  const dense = new Float32Array(S * S);
  for (let n = 0; n < 1000; n++) drawPetal(sparse, S, r() * S, r() * S, r() * Math.PI * 2, 7 + r() * 4.5);
  for (let n = 0; n < 6500; n++) drawPetal(dense, S, r() * S, r() * S, r() * Math.PI * 2, 7 + r() * 4.5);
  const data = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    data[i * 4] = byte(lum[i] * 127.5);
    data[i * 4 + 1] = byte(127.5 + warm[i] * 127.5);
    data[i * 4 + 2] = byte(sparse[i] * 255);
    data[i * 4 + 3] = byte(dense[i] * 255);
  }
  return makeTexture(data, S, S, aniso);
}

// Macro noise fields (four independent smooth fbm), tile 256 px, sampled at several world scales
// in the shaders so nothing ever visibly repeats.
function makeMacroTexture(aniso) {
  const S = 256;
  const data = new Uint8Array(S * S * 4);
  const f = [tileFbm(601, 3, 3, 4, 1.9), tileFbm(602, 4, 4, 4, 1.9), tileFbm(603, 5, 5, 4, 1.9), tileFbm(604, 4, 4, 4, 1.9)];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      for (let k = 0; k < 4; k++) data[i + k] = byte(f[k](x / S, y / S) * 255);
    }
  }
  return makeTexture(data, S, S, aniso);
}

/* ------------------------------------------------------------------ */
/* geometry builder                                                     */
/* ------------------------------------------------------------------ */
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();

function makeBuilder() {
  const P = [];
  const N = [];
  const C = [];
  const M = [];
  const I = [];
  const b = {
    m: new THREE.Matrix4(),
    setM(m) {
      b.m.copy(m);
    },
    v(p, n, c, moss) {
      _v.set(p[0], p[1], p[2]).applyMatrix4(b.m);
      _n.set(n[0], n[1], n[2]).transformDirection(b.m);
      P.push(_v.x, _v.y, _v.z);
      N.push(_n.x, _n.y, _n.z);
      C.push(c[0], c[1], c[2]);
      M.push(moss);
      return P.length / 3 - 1;
    },
    tri(a, c, d) {
      I.push(a, c, d);
    },
    triCount: () => I.length / 3,
    geometry() {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(C, 3));
      g.setAttribute("aMoss", new THREE.Float32BufferAttribute(M, 1));
      g.setIndex(P.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(I, 1) : new THREE.Uint16BufferAttribute(I, 1));
      return g;
    },
  };
  return b;
}

const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _nn = new THREE.Vector3();

// flat-shaded convex polygon, auto-oriented so its normal agrees with `hint`
function flatPoly(b, pts, hint, shade) {
  // Newell normal
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    nx += (p[1] - q[1]) * (p[2] + q[2]);
    ny += (p[2] - q[2]) * (p[0] + q[0]);
    nz += (p[0] - q[0]) * (p[1] + q[1]);
  }
  let ordered = pts;
  if (nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) {
    ordered = pts.slice().reverse();
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  const len = Math.hypot(nx, ny, nz) || 1;
  const n = [nx / len, ny / len, nz / len];
  const idx = ordered.map((p) => {
    const c = shade(p, n);
    return b.v(p, n, c, c[3]);
  });
  for (let i = 1; i < idx.length - 1; i++) b.tri(idx[0], idx[i], idx[i + 1]);
}

// push an existing three geometry (indexed or not) through the builder
function addGeo(b, geo, shade) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const base = [];
  for (let i = 0; i < pos.count; i++) {
    const p = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    const n = [nor.getX(i), nor.getY(i), nor.getZ(i)];
    const c = shade(p, n);
    base.push(b.v(p, n, c, c[3]));
  }
  if (geo.index) {
    for (let i = 0; i < geo.index.count; i += 3) b.tri(base[geo.index.getX(i)], base[geo.index.getX(i + 1)], base[geo.index.getX(i + 2)]);
  } else {
    for (let i = 0; i < pos.count; i += 3) b.tri(base[i], base[i + 1], base[i + 2]);
  }
}

// chamfered block, local coords centred on x/z = 0, y from y0 (bottom) to y1 (top)
function addBevelBlock(b, { w, l, y0, y1, bevel, shade }) {
  const hx = w / 2;
  const hz = l / 2;
  const bv = bevel;
  const T = [
    [-hx + bv, y1, -hz + bv],
    [hx - bv, y1, -hz + bv],
    [hx - bv, y1, hz - bv],
    [-hx + bv, y1, hz - bv],
  ];
  flatPoly(b, T, [0, 1, 0], shade);
  const L = [
    [-hx, y1 - bv, -hz],
    [hx, y1 - bv, -hz],
    [hx, y1 - bv, hz],
    [-hx, y1 - bv, hz],
  ];
  const B = [
    [-hx, y0, -hz],
    [hx, y0, -hz],
    [hx, y0, hz],
    [-hx, y0, hz],
  ];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const mx = (L[i][0] + L[j][0]) / 2;
    const mz = (L[i][2] + L[j][2]) / 2;
    const hl = Math.hypot(mx, mz) || 1;
    if (bv > 0) flatPoly(b, [T[i], T[j], L[j], L[i]], [mx / hl, 0.8, mz / hl], shade);
    flatPoly(b, [L[i], L[j], B[j], B[i]], [mx, 0, mz], shade);
  }
}

// hexagonal prism, corners at 30° + 60°·k (so faces point along ±x, ±60°, ±120°)
function addHexPrism(b, { R0, R1 = R0, y0, y1, skipAngles = [], shade, top = true }) {
  const c0 = [];
  const c1 = [];
  for (let k = 0; k < 6; k++) {
    const a = ((30 + 60 * k) * Math.PI) / 180;
    c0.push([R0 * Math.cos(a), y0, R0 * Math.sin(a)]);
    c1.push([R1 * Math.cos(a), y1, R1 * Math.sin(a)]);
  }
  for (let k = 0; k < 6; k++) {
    const j = (k + 1) % 6;
    const deg = (60 * (k + 1)) % 360;
    if (skipAngles.includes(deg)) continue;
    const na = (deg * Math.PI) / 180;
    flatPoly(b, [c0[k], c0[j], c1[j], c1[k]], [Math.cos(na), 0, Math.sin(na)], shade);
  }
  if (top) flatPoly(b, c1, [0, 1, 0], shade);
}

/* ------------------------------------------------------------------ */
/* stone lantern (tōrō)                                                 */
/* ------------------------------------------------------------------ */
function stoneShade(base, { aoH = 0.45, aoMin = 0.55, mossTop = 0.5, mossLow = 0.6, mossMul = 1, jitter = 0.06, seed = 0 }) {
  return (p, n) => {
    const y = p[1];
    const low = 1 - smooth(0, aoH, y);
    let ao = mix(1, aoMin, low);
    if (n[1] < -0.5) ao *= 0.78;
    const k = 1 + (hash3(p[0], p[1], p[2], seed) - 0.5) * 2 * jitter;
    const m = clamp01(((n[1] > 0.5 ? mossTop : 0) + low * mossLow) * mossMul);
    return [base[0] * ao * k, base[1] * ao * k, base[2] * ao * k, m];
  };
}

function buildLantern(b, place, rnd) {
  b.setM(place);
  const tone = alb("#b6b1a6", 0.98 + rnd() * 0.06);
  const mossMul = 0.55 + rnd() * 0.8;
  const sh = stoneShade(tone, { mossMul, seed: rnd() * 10 });
  const shDark = stoneShade(mixRGB(tone, [0.02, 0.02, 0.02], 0.12), { mossMul: mossMul * 0.7, seed: rnd() * 10 });
  const inner = () => [0.035, 0.03, 0.026, 0];

  // foundation slab + hexagonal base
  const shBase = stoneShade(mixRGB(tone, [0.02, 0.02, 0.02], 0.1), { mossTop: 0.2, mossLow: 0.3, mossMul, seed: rnd() * 10 });
  addBevelBlock(b, { w: 1.02, l: 1.02, y0: -0.1, y1: 0.09, bevel: 0.022, shade: shBase });
  addHexPrism(b, { R0: 0.38, R1: 0.355, y0: 0.09, y1: 0.24, shade: sh });

  // lotus cup (uke-bana)
  const cup = new THREE.LatheGeometry(
    [new THREE.Vector2(0.15, 0.24), new THREE.Vector2(0.245, 0.285), new THREE.Vector2(0.295, 0.36), new THREE.Vector2(0.28, 0.4), new THREE.Vector2(0.12, 0.42)],
    10
  );
  addGeo(b, cup, sh);
  cup.dispose();

  // pole (sao) with its bamboo-node band
  const pole = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.115, 0.42),
      new THREE.Vector2(0.1, 0.52),
      new THREE.Vector2(0.098, 0.72),
      new THREE.Vector2(0.15, 0.755),
      new THREE.Vector2(0.155, 0.81),
      new THREE.Vector2(0.104, 0.845),
      new THREE.Vector2(0.104, 1.1),
      new THREE.Vector2(0.125, 1.28),
    ],
    10
  );
  addGeo(b, pole, sh);
  pole.dispose();

  // inverted-lotus flare under the platform
  const flare = new THREE.LatheGeometry(
    [new THREE.Vector2(0.125, 1.28), new THREE.Vector2(0.21, 1.31), new THREE.Vector2(0.285, 1.345), new THREE.Vector2(0.3, 1.37)],
    10
  );
  addGeo(b, flare, shDark);
  flare.dispose();

  // platform (chūdai)
  addHexPrism(b, { R0: 0.37, R1: 0.36, y0: 1.37, y1: 1.47, shade: sh });

  // fire box (hibukuro): four blank faces + two windows facing ±x
  const R = 0.24;
  const a = R * Math.cos(Math.PI / 6);
  const hw = a * Math.tan(Math.PI / 6);
  const ya = 1.47;
  const yb = 1.9;
  addHexPrism(b, { R0: R, y0: ya, y1: yb, skipAngles: [0, 180], shade: sh, top: false });
  const win = (rotY) => {
    const m = new THREE.Matrix4().copy(place).multiply(new THREE.Matrix4().makeRotationY(rotY));
    b.setM(m);
    const wh = 0.066;
    const h0 = 1.57;
    const h1 = 1.81;
    const d = 0.075;
    const X = a;
    flatPoly(b, [[X, ya, -hw], [X, ya, -wh], [X, yb, -wh], [X, yb, -hw]], [1, 0, 0], sh);
    flatPoly(b, [[X, ya, wh], [X, ya, hw], [X, yb, hw], [X, yb, wh]], [1, 0, 0], sh);
    flatPoly(b, [[X, ya, -wh], [X, ya, wh], [X, h0, wh], [X, h0, -wh]], [1, 0, 0], sh);
    flatPoly(b, [[X, h1, -wh], [X, h1, wh], [X, yb, wh], [X, yb, -wh]], [1, 0, 0], sh);
    flatPoly(b, [[X - d, h0, -wh], [X - d, h0, wh], [X - d, h1, wh], [X - d, h1, -wh]], [1, 0, 0], inner);
    flatPoly(b, [[X, h0, -wh], [X - d, h0, -wh], [X - d, h1, -wh], [X, h1, -wh]], [0, 0, 1], inner);
    flatPoly(b, [[X, h0, wh], [X - d, h0, wh], [X - d, h1, wh], [X, h1, wh]], [0, 0, -1], inner);
    flatPoly(b, [[X, h0, -wh], [X, h0, wh], [X - d, h0, wh], [X - d, h0, -wh]], [0, 1, 0], inner);
    flatPoly(b, [[X, h1, -wh], [X, h1, wh], [X - d, h1, wh], [X - d, h1, -wh]], [0, -1, 0], inner);
  };
  win(0);
  win(Math.PI);
  b.setM(place);

  // roof (kasa): hexagonal, concave, corners swept up
  const RC = 0.68;
  const rings = 6;
  const yEave = 1.9;
  const rim = 0.05;
  const topH = 0.32;
  const ringPts = [];
  for (let k = 0; k <= rings; k++) {
    const s = k / rings;
    const rf = 1 - s * 0.86;
    const pts = [];
    for (let j = 0; j < 12; j++) {
      const corner = j % 2 === 0;
      const ang = ((30 + 60 * Math.floor(j / 2) + (corner ? 0 : 30)) * Math.PI) / 180;
      const rad = RC * rf * (corner ? 1 : 0.8);
      const lift = corner ? 0.1 * (1 - s) ** 2.2 : 0;
      const y = yEave + rim + topH * s ** 1.55 + lift;
      pts.push([rad * Math.cos(ang), y, rad * Math.sin(ang)]);
    }
    ringPts.push(pts);
  }
  const roofSh = stoneShade(mixRGB(tone, [0.5, 0.5, 0.5], 0.05), { aoH: 0.05, aoMin: 1, mossTop: 0.55 + rnd() * 0.3, mossLow: 0, mossMul: 1, seed: rnd() * 10 });
  const roofShade = (p, n) => {
    const c = roofSh(p, n);
    // moss creeps upwards from the eaves; the tip stays clean
    const up = smooth(yEave + rim, yEave + rim + topH * 0.8, p[1]);
    c[3] = clamp01(c[3] * (0.55 + 0.5 * (1 - up)) * mossMul);
    return c;
  };
  for (let k = 0; k < rings; k++) {
    for (let j = 0; j < 12; j++) {
      const j2 = (j + 1) % 12;
      const p0 = ringPts[k][j];
      const p1 = ringPts[k][j2];
      const p2 = ringPts[k + 1][j2];
      const p3 = ringPts[k + 1][j];
      flatPoly(b, [p0, p1, p2, p3], [(p0[0] + p1[0]) * 0.5, 1.2, (p0[2] + p1[2]) * 0.5], roofShade);
    }
  }
  const top = ringPts[rings];
  flatPoly(b, top, [0, 1, 0], roofShade);
  // eave rim + underside
  const low = ringPts[0].map((p) => [p[0], yEave + (p[1] - (yEave + rim)) * 0.6 + 0.0, p[2]]);
  for (let j = 0; j < 12; j++) {
    const j2 = (j + 1) % 12;
    const p0 = low[j];
    const p1 = low[j2];
    const p2 = ringPts[0][j2];
    const p3 = ringPts[0][j];
    flatPoly(b, [p0, p1, p2, p3], [p0[0] + p1[0], 0.2, p0[2] + p1[2]], shDark);
  }
  flatPoly(b, low, [0, -1, 0], shDark);

  // finial (hōju)
  const yTop = yEave + rim + topH;
  const fin = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.09, yTop),
      new THREE.Vector2(0.1, yTop + 0.025),
      new THREE.Vector2(0.05, yTop + 0.06),
      new THREE.Vector2(0.045, yTop + 0.09),
      new THREE.Vector2(0.095, yTop + 0.135),
      new THREE.Vector2(0.07, yTop + 0.2),
      new THREE.Vector2(0.025, yTop + 0.25),
      new THREE.Vector2(0.0, yTop + 0.28),
    ],
    10
  );
  addGeo(b, fin, roofShade);
  fin.dispose();
}
/* ------------------------------------------------------------------ */
/* shared GLSL: ground palette, fallen petals                           */
/* ------------------------------------------------------------------ */
const glslVec = (a) => `vec3(${a[0].toFixed(4)}, ${a[1].toFixed(4)}, ${a[2].toFixed(4)})`;

// Moss-garden ground colour from world position alone: four independent macro noise fields
// sampled at 54 m / 21 m / 8 m / 3.4 m so there is no repetition and no fixed vertex resolution.
const MACRO_DECL = "uniform sampler2D uMacro;";
const RAKE_PITCH = 0.06; // metres between the raked gravel ridges
const GROUND_GLSL = /* glsl */ `
const vec3 G_OLIVE  = ${glslVec(alb("#7f9157"))};
const vec3 G_LIGHT  = ${glslVec(alb("#8f9f66"))};
const vec3 G_DEEP   = ${glslVec(alb("#6b7f4f"))};
const vec3 G_DARK   = ${glslVec(alb("#586c43"))};
const vec3 G_EARTH  = ${glslVec(alb("#8b7458"))};
const vec3 G_DRY    = ${glslVec(alb("#a19365"))};
const vec3 G_CLOVER = ${glslVec(alb("#a8b97c"))};
vec3 groundPaletteD(vec2 p, float det) {
  vec4 m1 = texture2D(uMacro, p * 0.0185 + vec2(0.13, 0.71));
  // a gentle domain warp (about +-1.6 m) so the finer fields never line up on a visible lattice
  vec2 wv = (texture2D(uMacro, p * 0.023 + vec2(0.7, 0.2)).rg - 0.5) * 3.2;
  vec2 pw = p + wv;
  vec4 m2 = texture2D(uMacro, pw * 0.047 + vec2(0.52, 0.19));
  vec4 m3 = texture2D(uMacro, pw * 0.121 + vec2(0.83, 0.37));
  vec4 m4 = texture2D(uMacro, ROT * pw * 0.23 + vec2(0.27, 0.64));
  // 'det' (fine luminance detail) ragged-edges every patch so no contour line ever shows
  vec3 col = mix(G_OLIVE, G_LIGHT, smoothstep(0.32, 0.68, m2.g + det * 0.5));
  col = mix(col, G_DEEP, smoothstep(0.45, 0.8, m1.r + det * 0.4) * 0.75);
  col = mix(col, G_DARK, smoothstep(0.6, 0.9, m4.a * 0.7 + m2.r * 0.3 + (m1.b - 0.5) * 0.4 + det) * 0.5);
  col = mix(col, G_EARTH, smoothstep(0.68, 0.9, m3.b * 0.6 + m1.g * 0.4 + det) * 0.6);
  col = mix(col, G_DRY, smoothstep(0.62, 0.86, m3.r * 0.5 + m1.b * 0.5 + det) * 0.4);
  col = mix(col, G_CLOVER, smoothstep(0.66, 0.86, m4.g * 0.6 + m2.b * 0.4 + det) * 0.5);
  return col;
}
vec3 groundPalette(vec2 p) { return groundPaletteD(p, 0.0); }
`;

// Fallen blossom: density field (drifts against the kerb and under the tree ranks) + a mask read
// from the two ground-detail samples (B = sparse specks everywhere, A = dense drift specks).
const PETAL_GLSL = /* glsl */ `
float petalDrift(vec2 p) {
  float ax = abs(p.x);
  float kerb = exp(-max(ax - 3.3, 0.0) * 1.6) * step(2.9, ax);
  float rank = exp(-pow((ax - 6.6) * 0.55, 2.0));
  float outer = exp(-pow((ax - 15.0) * 0.22, 2.0)) * 0.5;
  vec4 m = texture2D(uMacro, p * vec2(0.23, 0.19) + vec2(0.29, 0.51));
  vec4 m2 = texture2D(uMacro, p * 0.61 + vec2(0.7, 0.7));
  float clumpy = smoothstep(0.38, 0.68, m.g * 0.6 + m2.r * 0.4);
  return clamp(kerb * 0.95 * (0.6 + 0.4 * clumpy) + (rank * 0.9 + outer * 0.45) * clumpy, 0.0, 1.0);
}
float petalMask(vec4 d1, vec4 d2, float wBase, float wDrift) {
  return clamp(max(d1.b, d2.b) * wBase + d2.a * wDrift + 0.4 * d1.a * wDrift * wDrift, 0.0, 1.0);
}
vec3 petalAlbedo(vec2 p) {
  vec4 m = texture2D(uMacro, p * 2.71 + vec2(0.41, 0.83));
  return mix(${glslVec(alb("#f9dce5", 0.97))}, ${glslVec(alb("#ea9db8", 0.97))}, smoothstep(0.3, 0.72, m.b));
}
`;

const ROT_GLSL = /* glsl */ `const mat2 ROT = mat2(0.883, 0.469, -0.469, 0.883);`;

/* ------------------------------------------------------------------ */
/* paving layout                                                        */
/* ------------------------------------------------------------------ */
const PAVE_Z0 = PATH.zStart + 6; // the path starts behind the hero camera ...
const PAVE_Z1 = PATH.zEnd - 60; // ... and runs on into the mist
const PAVE_EDGE = 0.17; // width of the border stones

function layoutPaving(rnd) {
  const slabs = [];
  const HW = PATH.halfWidth;
  const fieldHalf = HW - PAVE_EDGE;
  const fieldW = fieldHalf * 2;
  const palette = [
    { c: alb("#b2b0ab"), w: 3 },
    { c: alb("#b6b0a5"), w: 3 },
    { c: alb("#a9acaf"), w: 2 },
    { c: alb("#bdb9af"), w: 2 },
    { c: alb("#b3aca8"), w: 1.5 },
    { c: alb("#9b9c9b"), w: 0.8 },
    { c: alb("#a9aaa3"), w: 0.9 },
    { c: alb("#b0a89b"), w: 1.2 },
  ];
  const totalW = palette.reduce((a, p) => a + p.w, 0);
  const pickTone = () => {
    let t = rnd() * totalW;
    for (const p of palette) {
      t -= p.w;
      if (t <= 0) return p.c;
    }
    return palette[0].c;
  };
  // cells tile the path exactly: the dark joint is drawn by the shader along each cell edge
  const push = (x, z, w, d, tone, edge) => {
    const k = 0.9 + rnd() * 0.18;
    const settled = rnd() < 0.1;
    slabs.push({
      x,
      z,
      w,
      d,
      seed: 0.03 + rnd() * 0.94,
      tilt: [range(rnd, -0.02, 0.02) * (settled ? 2.2 : 1), range(rnd, -0.02, 0.02) * (settled ? 2.2 : 1)],
      tone: [tone[0] * k, tone[1] * k, tone[2] * k],
      moss: (rnd() < 0.22 ? range(rnd, 0.5, 1) : range(rnd, 0, 0.32)) * (edge ? 0.9 : 1),
    });
  };
  let z = PAVE_Z0;
  let prev = [];
  while (z > PAVE_Z1) {
    const far = z < -100 ? 1.7 : 1;
    const big = rnd() < 0.16;
    const depth = (big ? range(rnd, 1.05, 1.45) : range(rnd, 0.5, 0.98)) * far;
    let widths = [];
    let splits = [];
    for (let attempt = 0; attempt < 18; attempt++) {
      const roll = rnd();
      const count = roll < 0.2 ? 2 : roll < 0.66 ? 3 : roll < 0.92 ? 4 : 5;
      const wts = Array.from({ length: count }, () => range(rnd, 0.62, 1.4));
      const sum = wts.reduce((a, b) => a + b, 0);
      widths = wts.map((w) => (w / sum) * fieldW);
      splits = [];
      let acc = -fieldHalf;
      for (let i = 0; i < count - 1; i++) {
        acc += widths[i];
        splits.push(acc);
      }
      if (Math.min(...widths) >= 0.48 && splits.every((s) => prev.every((p) => Math.abs(s - p) > 0.26))) break;
    }
    prev = splits;
    let cursor = -fieldHalf;
    for (const w of widths) {
      push(cursor + w / 2, z - depth / 2, w, depth, pickTone(), false);
      cursor += w;
    }
    z -= depth;
  }
  // border stones along both edges of the paving
  for (const side of [-1, 1]) {
    let zz = PAVE_Z0;
    while (zz > PAVE_Z1) {
      const len = range(rnd, 0.7, 1.55) * (zz < -100 ? 1.7 : 1);
      const tone = mixRGB(pickTone(), alb("#8e908f"), 0.55);
      push(side * (HW - PAVE_EDGE / 2), zz - len / 2, PAVE_EDGE, len, tone, true);
      zz -= len;
    }
  }
  return slabs;
}

// unit cell: x,z in -.5..+.5, two columns in x so the camber follows the curve (4 triangles)
function makePavingGeometry() {
  const P = [-0.5, 0, -0.5, 0, 0, -0.5, 0.5, 0, -0.5, -0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0.5];
  const N = [];
  for (let i = 0; i < 6; i++) N.push(0, 1, 0);
  // (x-,z-) (x0,z-) (x+,z-) / (x-,z+) (x0,z+) (x+,z+); faces up
  const I = [0, 3, 4, 0, 4, 1, 1, 4, 5, 1, 5, 2];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
  g.setIndex(I);
  return g;
}

const CAMBER_GLSL = /* glsl */ `
float pvCamber(float x) {
  float u = clamp(x / ${PATH.halfWidth.toFixed(3)}, -1.0, 1.0);
  return 0.03 + 0.03 * (1.0 - u * u);
}
`;

/* ------------------------------------------------------------------ */
/* paving material: analytic joints / arrises / chips, no aliasing       */
/* ------------------------------------------------------------------ */
function makePavingMaterial(grain, ground, macro, mossColor) {
  const mat = new THREE.MeshLambertMaterial();
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGrain = { value: grain };
    shader.uniforms.uGround = { value: ground };
    shader.uniforms.uMacro = { value: macro };
    shader.uniforms.uMoss = { value: new THREE.Vector3(...mossColor) };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute vec4 aSlab;
        attribute vec3 aTone;
        attribute vec2 aTilt;
        varying vec2 vLoc;
        varying vec4 vSlab;
        varying vec3 vTone;
        varying vec2 vTilt;
        varying vec3 vWPos;
        ${CAMBER_GLSL}`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vLoc = position.xz * aSlab.xy;
        vSlab = aSlab;
        vTone = aTone;
        vTilt = aTilt;
        {
          vec4 wpi = instanceMatrix * vec4(transformed, 1.0);
          transformed.y = pvCamber(wpi.x);
        }`
      )
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
        vWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform sampler2D uGrain;
        uniform sampler2D uGround;
        uniform vec3 uMoss;
        varying vec2 vLoc;
        varying vec4 vSlab;
        varying vec3 vTone;
        varying vec2 vTilt;
        varying vec3 vWPos;
        ${ROT_GLSL}
        ${MACRO_DECL}
        ${PETAL_GLSL}
        const vec3 J_DARK = ${glslVec(alb("#3b3630", 1))};
        const vec3 J_MOSS = ${glslVec(alb("#43552f", 1))};
        vec2 pvBev = vec2(0.0);`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        {
          vec2 q = 0.5 * vSlab.xy - abs(vLoc);
          float ed = min(q.x, q.y);                       // metres to the nearest cell edge
          float aa = max(fwidth(ed), 1e-4);               // pixel footprint in metres
          float sd = vSlab.w;
          float r1 = fract(sd * 7.31);
          float r2 = fract(sd * 13.7);
          float r3 = fract(sd * 3.77);
          float r4 = fract(sd * 23.9);
          vec4 gr = texture2D(uGrain, vWPos.xz);
          vec4 gl = texture2D(uGrain, vWPos.xz * 0.27 + vec2(0.13, 0.41));

          // joint half width, widened by edge chips and one broken corner on some slabs
          float jw = mix(0.0045, 0.0085, r1);
          vec2 cs = vec2(r3 < 0.5 ? -1.0 : 1.0, r4 < 0.5 ? -1.0 : 1.0);
          vec2 cd = 0.5 * vSlab.xy - vLoc * cs;
          float chipR = 0.02 + 0.04 * fract(sd * 31.1);
          float cornerCut = step(0.74, fract(sd * 17.3)) * max(0.0, chipR - (cd.x + cd.y)) * 0.6;
          float jwE = jw + max(0.0, 0.5 - gr.g) * (0.006 + 0.012 * r2) + cornerCut;
          float tt = ed / aa;
          float ww = jwE / aa;
          float jointCov = clamp(min(tt + 0.5, ww) - max(tt - 0.5, -ww), 0.0, 1.0);

          // rounded arris: normal tilts outwards inside a narrow band, fades with distance
          float e = ed - jwE;
          float bw = 0.014;
          float bev = (1.0 - smoothstep(0.0, bw, e)) * step(0.0, e) * clamp(bw / (aa * 1.4), 0.0, 1.0);
          vec2 od = (q.x < q.y) ? vec2(sign(vLoc.x), 0.0) : vec2(0.0, sign(vLoc.y));
          pvBev = od * bev;

          // granite: speckle, blotches, long rain streaks
          vec3 slab = vTone * (1.0 + (gr.r * 2.0 - 1.0) * 1.7) * mix(0.82, 1.2, gl.b) * mix(0.94, 1.06, gr.g);
          slab *= mix(0.9, 1.05, texture2D(uGrain, vec2(vWPos.x * 2.3, vWPos.z * 0.31)).b);
          slab *= mix(0.93, mix(0.8, 1.0, smoothstep(0.0, 0.04, e)), clamp(0.04 / (aa * 1.5), 0.0, 1.0));
          slab *= 1.0 + 0.1 * bev;

          // moss creeping in from the joints
          float mn = gr.a * 0.45 + gl.a * 0.35 + gr.g * 0.2;
          float mossNear = 1.0 - smoothstep(0.0, 0.13, e + (gl.g - 0.5) * 0.08);
          float mossV = vSlab.z * 0.6 * (0.22 + 1.15 * mossNear) + (mn - 0.5) * 0.85;
          float moss = smoothstep(0.4, 0.66, mossV);
          vec3 mossCol = uMoss * (0.6 + 0.6 * gr.r + 0.3 * gl.g);
          slab = mix(slab, mossCol, moss * 0.85);

          // moss in the joints is patchy along the line, not a green outline
          float jm = smoothstep(0.5, 0.8, vSlab.z * 0.55 + (mn - 0.5) * 1.3 + 0.2);
          vec3 jointCol = mix(J_DARK, J_MOSS, jm * 0.7) * (0.85 + 0.3 * gr.r);

          // a few fallen petals: more along the border stones
          vec2 pp = vWPos.xz;
          vec4 d1 = texture2D(uGround, pp * 0.5);
          vec4 d2 = texture2D(uGround, ROT * pp * 0.37 + vec2(0.31, 0.77));
          float edgeW = smoothstep(0.6, 1.0, abs(vWPos.x) / ${PATH.halfWidth.toFixed(3)});
          float drift = petalDrift(pp);
          float pm = petalMask(d1, d2, 0.45 + 0.4 * edgeW, smoothstep(0.35, 0.8, drift) * (0.25 + 0.6 * edgeW));

          vec3 col = mix(slab, jointCol, jointCov);
          col = mix(col, petalAlbedo(pp), pm * (1.0 - jointCov) * 0.95);
          diffuseColor.rgb = col;
        }`
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        {
          float camX = 0.06 * clamp(vWPos.x, -${PATH.halfWidth.toFixed(3)}, ${PATH.halfWidth.toFixed(3)}) / ${(PATH.halfWidth * PATH.halfWidth).toFixed(4)};
          vec3 nw = normalize(vec3(camX + vTilt.x + pvBev.x * 1.1, 1.0, vTilt.y + pvBev.y * 1.1));
          normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
        }`
      );
  };
  return mat;
}

/* ------------------------------------------------------------------ */
/* shaders (Lambert + world-space procedural detail)                    */
/* ------------------------------------------------------------------ */
const WPOS_VERT_DECL = /* glsl */ `
  varying vec3 vWPos;
  varying vec3 vWNor;
`;
const WPOS_VERT = /* glsl */ `
  vec4 wp_ = vec4(transformed, 1.0);
  vec3 wn_ = objectNormal;
  #ifdef USE_INSTANCING
    wp_ = instanceMatrix * wp_;
    wn_ = mat3(instanceMatrix) * wn_;
  #endif
  wp_ = modelMatrix * wp_;
  vWPos = wp_.xyz;
  vWNor = mat3(modelMatrix) * wn_;
`;

function makeStoneMaterial(grain, mossColor) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGrain = { value: grain };
    shader.uniforms.uMoss = { value: new THREE.Vector3(...mossColor) };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        ${WPOS_VERT_DECL}
        attribute float aMoss;
        varying float vMoss;`
      )
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
        ${WPOS_VERT}
        vMoss = aMoss;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform sampler2D uGrain;
        uniform vec3 uMoss;
        varying vec3 vWPos;
        varying vec3 vWNor;
        varying float vMoss;`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        {
          vec3 wn = normalize(vWNor);
          vec3 wt = pow(abs(wn), vec3(6.0));
          wt /= (wt.x + wt.y + wt.z);
          vec4 f = texture2D(uGrain, vWPos.zy) * wt.x + texture2D(uGrain, vWPos.xz) * wt.y + texture2D(uGrain, vWPos.xy) * wt.z;
          vec4 l = texture2D(uGrain, vWPos.zy * 0.27 + 0.13) * wt.x + texture2D(uGrain, vWPos.xz * 0.27 + 0.41) * wt.y + texture2D(uGrain, vWPos.xy * 0.27 + 0.71) * wt.z;
          float grainM = f.r * 2.0;
          float blot = mix(0.86, 1.18, l.b) * mix(0.94, 1.06, f.g);
          diffuseColor.rgb *= grainM * blot;
          float mn = f.a * 0.45 + l.a * 0.35 + f.g * 0.2;
          float moss = smoothstep(0.42, 0.64, vMoss + (mn - 0.5) * 0.95);
          vec3 mossCol = uMoss * (0.62 + 0.55 * f.r * 2.0 * 0.5 + 0.35 * l.g);
          diffuseColor.rgb = mix(diffuseColor.rgb, mossCol, moss * 0.9);
          // rain streaks and grime run down the vertical faces
          float rain = texture2D(uGrain, vec2((vWPos.x + vWPos.z) * 3.1, vWPos.y * 0.31)).b;
          diffuseColor.rgb *= mix(1.0, mix(0.8, 1.05, rain), 1.0 - abs(wn.y));
        }`
      );
  };
  return mat;
}


/* ------------------------------------------------------------------ */
/* gravel: analytic rake lines (fade out before they can shimmer)        */
/* ------------------------------------------------------------------ */
function makeGravelMaterial(gravel, ground, macro) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGravel = { value: gravel };
    shader.uniforms.uGround = { value: ground };
    shader.uniforms.uMacro = { value: macro };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vWPos;`)
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform sampler2D uGravel;
        uniform sampler2D uGround;
        varying vec3 vWPos;
        ${ROT_GLSL}
        ${MACRO_DECL}
        ${PETAL_GLSL}
        float gvRake = 0.0;`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        {
          vec2 p = vWPos.xz;
          vec3 peb = mix(texture2D(uGravel, p).rgb, texture2D(uGravel, ROT * p * 0.43 + vec2(0.3, 0.7)).rgb, 0.45) * 2.0;
          vec4 mc = texture2D(uMacro, p * vec2(0.09, 0.05) + vec2(0.3, 0.3));
          vec4 mc2 = texture2D(uMacro, p * 0.31 + vec2(0.6, 0.2));
          // rake lines run along the path, wandering a little; fade out when they would alias
          float wob = 0.012 * sin(p.y * 0.31 + p.x * 0.17) + 0.009 * sin(p.y * 0.87 + 1.7) + 0.005 * sin(p.y * 2.3 + 0.4);
          float jit = (texture2D(uMacro, vec2(p.x * 3.1, p.y * 0.045) + vec2(0.2, 0.6)).g - 0.5) * 0.5;
          float ph = (p.x + wob) / ${RAKE_PITCH.toFixed(3)} + jit;
          float fw = fwidth(ph);
          float lineV = 0.72 + 0.28 * texture2D(uMacro, vec2(floor(ph) * 0.137, p.y * 0.013)).b;
          float amp = (1.0 - smoothstep(0.16, 0.5, fw)) * mix(0.55, 1.0, smoothstep(0.25, 0.6, mc.g)) * lineV;
          float sn = sin(6.28318 * ph);
          float cs = cos(6.28318 * ph);
          gvRake = amp * 0.3 * sn;
          vec3 col = max(mix(vec3(1.0), peb, 1.35), vec3(0.2)) * mix(0.94, 1.06, mc2.g) * mix(0.93, 1.07, mc.r);
          col *= 1.0 - 0.09 * amp * (0.5 - 0.5 * cs);
          diffuseColor.rgb *= col;
          vec4 d1 = texture2D(uGround, p * 0.5);
          vec4 d2 = texture2D(uGround, ROT * p * 0.37 + vec2(0.31, 0.77));
          float pm = petalMask(d1, d2, 0.75, smoothstep(0.24, 0.72, petalDrift(p)) * 0.85);
          diffuseColor.rgb = mix(diffuseColor.rgb, petalAlbedo(p), pm * 0.95);
        }`
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        normal = normalize((viewMatrix * vec4(normalize(vec3(gvRake, 1.0, 0.0)), 0.0)).xyz);`
      );
  };
  return mat;
}

/* ------------------------------------------------------------------ */
/* ground: moss garden                                                  */
/* ------------------------------------------------------------------ */
function makeGroundMaterial(ground, macro) {
  const mat = new THREE.MeshLambertMaterial();
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGround = { value: ground };
    shader.uniforms.uMacro = { value: macro };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vWPos;`)
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform sampler2D uGround;
        varying vec3 vWPos;
        ${ROT_GLSL}
        ${MACRO_DECL}
        ${GROUND_GLSL}
        ${PETAL_GLSL}`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        {
          vec2 p = vWPos.xz;
          float ax = abs(p.x);
          vec4 d1 = texture2D(uGround, p * 0.5);
          vec4 d2 = texture2D(uGround, ROT * p * 0.37 + vec2(0.31, 0.77));
          float lum = mix(d1.r, d2.r, 0.4) * 2.0;
          vec3 col = groundPaletteD(p, (lum - 1.0) * 0.28);
          float wrm = (mix(d1.g, d2.g, 0.4) - 0.5) * 2.0;
          col *= lum * vec3(1.0 + 0.16 * wrm, 1.0 + 0.02 * wrm, 1.0 - 0.2 * wrm);
          // damp, dark earth at the foot of the kerb
          float kd = ax - ${KERB_OUT.toFixed(2)};
          float mb = texture2D(uMacro, p * 0.9).b;
          float earth = 1.0 - smoothstep(0.0, 0.2, kd + (mb - 0.5) * 0.16);
          col = mix(col, G_EARTH * 0.72 * lum, earth * 0.7);
          col *= mix(0.74, 1.0, smoothstep(0.0, 1.7, kd));
          // fallen blossom
          float pm = petalMask(d1, d2, 1.0, smoothstep(0.2, 0.62, petalDrift(p)));
          col = mix(col, petalAlbedo(p) * (0.88 + 0.16 * lum), pm * 0.95);
          diffuseColor.rgb = col;
        }`
      );
  };
  return mat;
}

// fallen petals: lit like the ground they lie on (normal forced up), double sided
function makeSpriteMaterial({ emissive }) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  if (emissive) mat.emissive = new THREE.Color(...emissive);
  mat.onBeforeCompile = (shader) => {
    // petals shrink away with distance (the ground texture carries them further out), so
    // nothing sub-pixel ever twinkles
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        transformed *= 1.0 - smoothstep(7.0, 19.0, distance((modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz, cameraPosition));
      #endif`
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <normal_fragment_begin>",
      `float faceDirection = 1.0;
       vec3 normal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
       vec3 geometryNormal = normal;`
    );
  };
  return mat;
}

// grass tufts: take their colour from the very same ground palette as the terrain under them
function makeTuftMaterial(macro, uniforms) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uMacro = { value: macro };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uTime;
        ${ROT_GLSL}
        ${MACRO_DECL}
        ${GROUND_GLSL}`
      )
      .replace(
        "#include <color_vertex>",
        `#include <color_vertex>
        #ifdef USE_INSTANCING
          vColor.rgb *= groundPalette(instanceMatrix[3].xz) * 1.1;
        #endif`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float ph_ = uTime * 1.7 + instanceMatrix[3].x * 0.55 + instanceMatrix[3].z * 0.43;
          float hf_ = clamp(position.y, 0.0, 1.0);
          transformed.x += sin(ph_) * 0.14 * hf_ * hf_;
          transformed.z += cos(ph_ * 0.83) * 0.09 * hf_ * hf_;
          // blades sink away with distance: thin sub-pixel geometry would shimmer
          transformed *= 1.0 - smoothstep(26.0, 52.0, distance((modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz, cameraPosition));
        #endif`
      );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <normal_fragment_begin>",
      `float faceDirection = 1.0;
       vec3 normal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
       vec3 geometryNormal = normal;`
    );
  };
  return mat;
}

/* ------------------------------------------------------------------ */
/* terrain                                                              */
/* ------------------------------------------------------------------ */
function buildTerrain() {
  const xs = [3.3];
  let x = 3.3;
  for (const [lim, step] of [
    [7, 0.7],
    [20, 1.9],
    [60, 5],
    [150, 15],
  ]) {
    while (x < lim - 1e-6) {
      x = Math.min(lim, x + step);
      xs.push(x);
    }
  }
  const zs = [24];
  let z = 24;
  for (const [lim, step] of [
    [-20, 2],
    [-85, 4.06],
    [-215, 12],
  ]) {
    while (z > lim + 1e-6) {
      z = Math.max(lim, z - step);
      zs.push(z);
    }
  }
  const P = [];
  const N = [];
  const I = [];
  for (const side of [-1, 1]) {
    const base = P.length / 3;
    for (let i = 0; i < xs.length; i++) {
      for (let j = 0; j < zs.length; j++) {
        const X = side * xs[i];
        const Z = zs[j];
        const h = groundHeightAt(X, Z);
        const e = 0.6;
        const nx = groundHeightAt(X - e, Z) - groundHeightAt(X + e, Z);
        const nz = groundHeightAt(X, Z - e) - groundHeightAt(X, Z + e);
        const nl = Math.hypot(nx, 2 * e, nz);
        P.push(X, h, Z);
        N.push(nx / nl, (2 * e) / nl, nz / nl);
      }
    }
    for (let i = 0; i < xs.length - 1; i++) {
      for (let j = 0; j < zs.length - 1; j++) {
        const a = base + i * zs.length + j;
        const bq = base + i * zs.length + j + 1;
        const c = base + (i + 1) * zs.length + j;
        const d = base + (i + 1) * zs.length + j + 1;
        if (side > 0) I.push(a, c, bq, bq, c, d);
        else I.push(a, bq, c, bq, d, c);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
  g.setIndex(new THREE.Uint16BufferAttribute(I, 1));
  return g;
}

function buildGravel() {
  const b = makeBuilder();
  const base = alb("#d8d1c1");
  const cols = [
    [PATH.halfWidth, 0.84],
    [PATH.halfWidth + 0.1, 1.0],
    [KERB_IN - 0.12, 1.0],
    [KERB_IN + 0.05, 0.72],
  ];
  const z0 = PAVE_Z0 + 0.5;
  const z1 = PAVE_Z1 - 4;
  for (const side of [-1, 1]) {
    const idx = [];
    for (const [x, ao] of cols) {
      const c = [base[0] * ao, base[1] * ao, base[2] * ao];
      idx.push([b.v([side * x, GRAVEL_Y, z0], [0, 1, 0], c, 0), b.v([side * x, GRAVEL_Y, z1], [0, 1, 0], c, 0)]);
    }
    for (let i = 0; i < cols.length - 1; i++) {
      const [a0, a1] = idx[i];
      const [c0, c1] = idx[i + 1];
      if (side > 0) {
        b.tri(a0, c0, a1);
        b.tri(a1, c0, c1);
      } else {
        b.tri(a0, a1, c0);
        b.tri(a1, c1, c0);
      }
    }
  }
  return b.geometry();
}

/* ------------------------------------------------------------------ */
/* decals (lantern shadows)                                             */
/* ------------------------------------------------------------------ */
function buildDecals() {
  const P = [];
  const C = [];
  const I = [];
  const tint = [0.028, 0.045, 0.04];
  const surfaceY = (x, z) => groundHeightAt(x, z) + 0.004;
  // soft elliptical patch on a small grid, oriented along `dir`
  const patch = (cx, cz, dir, U, V, cell, alpha) => {
    const nu = Math.max(2, Math.round((2 * U) / cell));
    const nv = Math.max(2, Math.round((2 * V) / cell));
    const base = P.length / 3;
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const u = -U + (2 * U * i) / nu;
        const v = -V + (2 * V * j) / nv;
        const x = cx + dir[0] * u - dir[1] * v;
        const z = cz + dir[1] * u + dir[0] * v;
        const r = Math.hypot(u / U, v / V);
        const a = alpha * (1 - smooth(0.35, 1, r));
        P.push(x, surfaceY(x, z), z);
        C.push(tint[0], tint[1], tint[2], a);
      }
    }
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const a = base + j * (nu + 1) + i;
        const bq = a + 1;
        const c = a + (nu + 1);
        const d = c + 1;
        I.push(a, c, bq, bq, c, d);
      }
    }
  };
  for (const L of LANTERNS) {
    const dir = SHADOW_DIR;
    const h = 2.05;
    patch(L.x, L.z, dir, 0.95, 0.95, 0.3, 0.42); // contact shadow around the plinth
    patch(L.x + dir[0] * 1.35, L.z + dir[1] * 1.35, dir, 1.4, 0.3, 0.3, 0.26); // pole
    const off = h * SHADOW_STRETCH;
    patch(L.x + dir[0] * off, L.z + dir[1] * off, dir, 1.0, 0.72, 0.3, 0.34); // roof
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(C, 4));
  g.setIndex(P.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(I, 1) : new THREE.Uint16BufferAttribute(I, 1));
  return g;
}


/* ------------------------------------------------------------------ */
/* petals & grass (instanced)                                           */
/* ------------------------------------------------------------------ */
function makePetalGeometry() {
  // notched sakura petal, unit length ~1.75 along z
  const pts = [
    [0, 0.9, [1, 0.95, 0.96]], // tip
    [0.5, -0.2, [1, 0.98, 0.98]],
    [0.2, -0.85, [1, 0.93, 0.95]],
    [0, -0.58, [0.97, 0.8, 0.85]], // notch
    [-0.2, -0.85, [1, 0.93, 0.95]],
    [-0.5, -0.2, [1, 0.98, 0.98]],
  ];
  const P = [];
  const N = [];
  const C = [];
  for (const [x, z, c] of pts) {
    P.push(x, 0, z);
    N.push(0, 1, 0);
    C.push(c[0], c[1], c[2]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(C, 3));
  g.setIndex([0, 2, 1, 0, 3, 2, 0, 4, 3, 0, 5, 4]);
  return g;
}

function makeTuftGeometry() {
  const P = [];
  const N = [];
  const C = [];
  const I = [];
  const blades = 4;
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + 0.4 + (i % 2) * 0.35;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const bx = dx * 0.05;
    const bz = dz * 0.05;
    const w = 0.064;
    const lean = 0.26 + (i % 3) * 0.13;
    const hgt = 1 - i * 0.16;
    const base = P.length / 3;
    P.push(bx - dz * w, 0, bz + dx * w, bx + dz * w, 0, bz - dx * w, bx + dx * lean, hgt, bz + dz * lean);
    N.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    C.push(0.5, 0.56, 0.44, 0.5, 0.56, 0.44, 1.14, 1.12, 0.92);
    I.push(base, base + 1, base + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(C, 3));
  g.setIndex(I);
  return g;
}

// where fallen petals collect: along the kerb and under the tree ranks
function petalDensityJS(x, z) {
  const ax = Math.abs(x);
  const kerb = ax > 2.9 ? Math.exp(-Math.max(ax - 3.3, 0) * 1.1) : 0;
  const rank = Math.exp(-(((ax - 6.6) * 0.5) ** 2));
  const outer = Math.exp(-(((ax - 15) * 0.2) ** 2)) * 0.7;
  const clump = fbm(gN4, x * 0.23 + 3, z * 0.19 + 8, 3) * 0.65 + fbm(gN3, x * 0.61 + 7, z * 0.61 + 2, 2) * 0.35;
  return Math.min(1, (kerb * 0.9 + rank * 0.85 + outer * 0.55) * (0.35 + 1.3 * clump));
}

// mossy garden stone: an angular, half-buried boulder (faceted, moss on the upper faces)
function buildRock(b, x, y, z, size, rnd, tone, mossMul) {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const pos = geo.attributes.position;
  const sx = range(rnd, 1.0, 1.6);
  const sy = range(rnd, 0.55, 0.85);
  const sz = range(rnd, 0.9, 1.4);
  const ph = rnd() * 10;
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const py = pos.getY(i);
    const pz = pos.getZ(i);
    const k = 1 + (hash3(px * 3.1, py * 3.1, pz * 3.1, ph) - 0.5) * 0.46;
    pos.setXYZ(i, px * sx * size * k, py * sy * size * k, pz * sz * size * k);
  }
  geo.computeVertexNormals(); // non-indexed: one normal per face
  const m = new THREE.Matrix4().makeRotationY(rnd() * Math.PI * 2);
  m.setPosition(x, y, z);
  b.setM(m);
  addGeo(b, geo, stoneShade(tone, { aoH: size * 0.55, aoMin: 0.62, mossTop: 0.5, mossLow: 0.28, mossMul, jitter: 0.1, seed: rnd() * 10 }));
  geo.dispose();
}

/* ------------------------------------------------------------------ */
/* world assembly                                                       */
/* ------------------------------------------------------------------ */
function buildWorld(aniso) {
  const disposables = [];
  const track = (o) => {
    disposables.push(o);
    return o;
  };
  const rnd = mulberry32(20240607);

  const grain = track(makeGrainTexture(aniso));
  const gravelTex = track(makeGravelTexture(aniso));
  const groundTex = track(makeGroundTexture(aniso));
  const macroTex = track(makeMacroTexture(aniso));
  const mossColor = alb("#5a6d40", 1.0);
  const uniforms = { uTime: { value: 0 } };

  const group = new THREE.Group();
  group.name = "Sando";
  const addMesh = (mesh, order = 0) => {
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    group.add(mesh);
    return mesh;
  };

  // --- terrain -------------------------------------------------------
  const terrainGeo = track(buildTerrain());
  const terrainMat = track(makeGroundMaterial(groundTex, macroTex));
  addMesh(new THREE.Mesh(terrainGeo, terrainMat));

  // --- gravel strips ---------------------------------------------------
  const gravelGeo = track(buildGravel());
  const gravelMat = track(makeGravelMaterial(gravelTex, groundTex, macroTex));
  addMesh(new THREE.Mesh(gravelGeo, gravelMat));

  // --- static stone: paving skirt + kerbs + lanterns (one merged mesh) ------
  const props = makeBuilder();
  props.setM(new THREE.Matrix4());
  {
    // the vertical face of the border stones, so the raised paving never shows a gap
    const c = alb("#85847f", 1);
    const z0 = PAVE_Z0 + 0.4;
    const z1 = PAVE_Z1 - 4;
    for (const side of [-1, 1]) {
      const x = side * (PATH.halfWidth + 0.001);
      flatPoly(props, [[x, hPave(PATH.halfWidth) + 0.001, z0], [x, -0.03, z0], [x, -0.03, z1], [x, hPave(PATH.halfWidth) + 0.001, z1]], [side, 0, 0], (p) => {
        const ao = mix(0.55, 1, smooth(-0.03, 0.03, p[1]));
        return [c[0] * ao, c[1] * ao, c[2] * ao, 0.55];
      });
    }
  }
  // kerb stones along both sides of the gravel
  {
    const tones = [alb("#aaa59a"), alb("#b2aca0"), alb("#a4a5a2"), alb("#b7b0a3")];
    for (const side of [-1, 1]) {
      let z = PAVE_Z0 + 0.4;
      while (z > PAVE_Z1 - 4) {
        const far = z < -78;
        const len = far ? range(rnd, 1.8, 3.0) : range(rnd, 0.75, 1.55);
        const w = 0.2 + range(rnd, -0.012, 0.012);
        const hTop = 0.108 + range(rnd, -0.012, 0.01);
        const tone = tones[Math.floor(rnd() * tones.length)];
        const k = 0.94 + rnd() * 0.12;
        const c = [tone[0] * k, tone[1] * k, tone[2] * k];
        const mossAmt = rnd() < 0.3 ? range(rnd, 0.5, 0.95) : range(rnd, 0.05, 0.4);
        const yaw = range(rnd, -0.012, 0.012);
        const m = new THREE.Matrix4().makeRotationY(yaw);
        m.setPosition(side * (KERB_IN + w / 2 + range(rnd, 0, 0.004)), 0, z - len / 2);
        props.setM(m);
        const y0 = 0;
        const shade = (p, n) => {
          const t = smooth(y0, hTop, p[1]);
          const ao = mix(0.6, 1, smooth(0.0, 0.55, t));
          const mm = clamp01((n[1] > 0.5 ? 0.55 : 0.1 + 0.55 * (1 - t) * (Math.abs(n[0]) > 0.5 ? 1 : 0.5)) * mossAmt * 1.25);
          const j = 1 + (hash3(p[0], p[1], p[2], z) - 0.5) * 0.06;
          return [c[0] * ao * j, c[1] * ao * j, c[2] * ao * j, mm];
        };
        addBevelBlock(props, { w, l: len - 0.012, y0: -0.05, y1: hTop, bevel: far ? 0 : 0.014, shade });
        z -= len;
      }
    }
  }
  // lanterns
  LANTERNS.forEach((L) => {
    const place = new THREE.Matrix4();
    const yaw = L.x < 0 ? 0 : Math.PI;
    place.makeRotationFromEuler(new THREE.Euler(range(rnd, -0.006, 0.006), yaw + range(rnd, -0.03, 0.03), range(rnd, -0.006, 0.006)));
    place.setPosition(L.x, groundHeightAt(L.x, L.z), L.z);
    buildLantern(props, place, rnd);
  });
  // mossy garden stones: tucked against the lanterns, a few scattered along the verge
  {
    const tones = [alb("#8f8b82"), alb("#9a968b"), alb("#858680")];
    const rockAt = (x, z, size) => {
      const tone = tones[Math.floor(rnd() * tones.length)];
      buildRock(props, x, groundHeightAt(x, z) + size * 0.14, z, size, rnd, tone, 0.65 + rnd() * 0.6);
    };
    LANTERNS.forEach((L) => {
      const s = Math.sign(L.x);
      rockAt(L.x + s * range(rnd, 1.0, 1.5), L.z + range(rnd, -1.1, 1.1), range(rnd, 0.2, 0.36));
      if (rnd() < 0.7) rockAt(L.x + s * range(rnd, 0.95, 1.9), L.z + range(rnd, -1.9, -0.8) * (rnd() < 0.5 ? 1 : -1), range(rnd, 0.12, 0.24));
      if (rnd() < 0.5) rockAt(s * range(rnd, 3.66, 3.78), L.z + range(rnd, -0.6, 0.6), range(rnd, 0.1, 0.16));
    });
    for (let i = 0; i < 11; i++) {
      const x = (rnd() < 0.5 ? -1 : 1) * (4.3 + rnd() ** 1.4 * 6);
      const z = 6 - rnd() * 110;
      if (LANTERNS.some((L) => Math.hypot(x - L.x, z - L.z) < 2.2)) continue;
      rockAt(x, z, range(rnd, 0.14, 0.4));
    }
  }
  const propsGeo = track(props.geometry());
  const stoneStatic = track(makeStoneMaterial(grain, mossColor));
  addMesh(new THREE.Mesh(propsGeo, stoneStatic));

  // --- flagstones (instanced flat cells, all detail is analytic in the shader) -------
  const slabs = layoutPaving(rnd);
  const slabGeo = track(makePavingGeometry());
  const slabMat = track(makePavingMaterial(grain, groundTex, macroTex, mossColor));
  const slabMesh = new THREE.InstancedMesh(slabGeo, slabMat, slabs.length);
  {
    const dummy = new THREE.Object3D();
    const aSlab = new Float32Array(slabs.length * 4);
    const aTone = new Float32Array(slabs.length * 3);
    const aTilt = new Float32Array(slabs.length * 2);
    slabs.forEach((s, i) => {
      dummy.position.set(s.x, 0, s.z);
      dummy.scale.set(s.w, 1, s.d);
      dummy.updateMatrix();
      slabMesh.setMatrixAt(i, dummy.matrix);
      aSlab.set([s.w, s.d, s.moss, s.seed], i * 4);
      aTone.set(s.tone, i * 3);
      aTilt.set(s.tilt, i * 2);
    });
    slabGeo.setAttribute("aSlab", new THREE.InstancedBufferAttribute(aSlab, 4));
    slabGeo.setAttribute("aTone", new THREE.InstancedBufferAttribute(aTone, 3));
    slabGeo.setAttribute("aTilt", new THREE.InstancedBufferAttribute(aTilt, 2));
  }
  addMesh(slabMesh);

  // --- petals ----------------------------------------------------------------
  {
    const petalGeo = track(makePetalGeometry());
    const petalMat = track(makeSpriteMaterial({ emissive: [0.14, 0.09, 0.1] }));
    const petalCols = [alb("#ffe7ec", 0.9), alb("#fbd5de", 0.9), alb("#f7c6d3", 0.9), alb("#fff4f2", 0.9), alb("#f4b9cb", 0.85)];
    const list = [];
    const zAt = () => PAVE_Z0 - 4 - 100 * rnd() ** 1.35;
    // paving: a few, more towards the edges
    for (let i = 0; i < 260; i++) {
      const x = (rnd() < 0.5 ? -1 : 1) * PATH.halfWidth * (1 - rnd() ** 2.2 * 0.95);
      list.push([x, hPave(x) + 0.006, zAt()]);
    }
    // gravel: concentrated against the kerb and the paving edge
    for (let i = 0; i < 520; i++) {
      const u = rnd();
      const off = u < 0.5 ? rnd() ** 2.4 * 0.7 : 1.4 - rnd() ** 2.4 * 0.7;
      const x = (rnd() < 0.5 ? -1 : 1) * (PATH.halfWidth + 0.03 + off * ((KERB_IN - 0.03 - PATH.halfWidth - 0.03) / 1.4));
      list.push([x, GRAVEL_Y + 0.006, zAt()]);
    }
    // verges: drifts by density (rejection sampled), a thin scatter elsewhere
    let guard = 0;
    let n = 0;
    while (n < 1700 && guard++ < 60000) {
      const side = rnd() < 0.5 ? -1 : 1;
      const x = side * (KERB_OUT + 0.06 + rnd() * rnd() * 19);
      const z = zAt();
      if (rnd() > petalDensityJS(x, z) * 0.9 + 0.06) continue;
      list.push([x, groundHeightAt(x, z) + 0.012, z]);
      n++;
    }
    const mesh = new THREE.InstancedMesh(petalGeo, petalMat, list.length);
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    list.forEach((p, i) => {
      dummy.position.set(p[0], p[1], p[2]);
      const curl = rnd() < 0.3 ? 0.35 : 0.08;
      dummy.rotation.set(range(rnd, -curl, curl), rnd() * Math.PI * 2, range(rnd, -curl, curl), "YXZ");
      const s = range(rnd, 0.0105, 0.02);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      const c = petalCols[Math.floor(rnd() * petalCols.length)];
      const k = 0.92 + rnd() * 0.16;
      col.setRGB(c[0] * k, c[1] * k, c[2] * k);
      mesh.setColorAt(i, col);
    });
    addMesh(mesh);
  }

  // --- grass tufts (clumps) --------------------------------------------------
  {
    const tuftGeo = track(makeTuftGeometry());
    const tuftMat = track(makeTuftMaterial(macroTex, uniforms));
    const list = [];
    const place = (cx, cz, spread, count) => {
      for (let k = 0; k < count; k++) {
        const x = cx + (rnd() + rnd() + rnd() - 1.5) * spread;
        const z = cz + (rnd() + rnd() + rnd() - 1.5) * spread;
        const ax = Math.abs(x);
        if (ax < KERB_OUT + 0.04 || ax > 36) continue;
        list.push([x, groundHeightAt(x, z) - 0.006, z]);
      }
    };
    for (let c = 0; c < 1500; c++) {
      const side = rnd() < 0.5 ? -1 : 1;
      const nearKerb = rnd() < 0.3;
      const x = side * (KERB_OUT + 0.06 + -Math.log(1 - rnd() * 0.999) * (nearKerb ? 0.5 : 5.5));
      const z = PAVE_Z0 - 4 - 100 * rnd() ** 1.15;
      place(x, z, 0.3, 2 + Math.floor(rnd() * 3));
    }
    for (const L of LANTERNS) place(L.x, L.z, 1.0, 10);
    const mesh = new THREE.InstancedMesh(tuftGeo, tuftMat, list.length);
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    list.forEach((p, i) => {
      dummy.position.set(p[0], p[1], p[2]);
      dummy.rotation.set(0, rnd() * Math.PI * 2, 0);
      const h = range(rnd, 0.07, 0.2) * (Math.abs(p[0]) < 5 ? 1.0 : 1.15);
      dummy.scale.set(h * 1.2, h, h * 1.2);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      const dry = rnd() < 0.16;
      const k = 0.85 + rnd() * 0.35;
      if (dry) col.setRGB(1.2 * k, 1.05 * k, 0.8 * k);
      else col.setRGB(k * (0.95 + rnd() * 0.15), k, k * 0.95);
      mesh.setColorAt(i, col);
    });
    addMesh(mesh);
  }

  // --- lantern shadows (last: transparent) -------------------------------------
  {
    const decalGeo = track(buildDecals());
    const decalMat = track(
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
    );
    addMesh(new THREE.Mesh(decalGeo, decalMat), 2);
  }

  return {
    group,
    uniforms,
    dispose() {
      disposables.forEach((d) => d.dispose && d.dispose());
      group.children.forEach((m) => m.dispose && m.dispose());
    },
  };
}

export default function Sando() {
  const gl = useThree((s) => s.gl);
  const world = useMemo(() => buildWorld(gl.capabilities.getMaxAnisotropy()), [gl]);
  useEffect(() => () => world.dispose(), [world]);
  useFrame((state) => {
    world.uniforms.uTime.value = state.clock.elapsedTime;
  });
  return <primitive object={world.group} />;
}
