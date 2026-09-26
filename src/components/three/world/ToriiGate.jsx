// ToriiGate — an architecturally faithful myojin-style Shinto torii.
//
// World contract: 1 unit = 1 m, Y up, origin at the centre of the ground line
// between the pillars, FRONT faces +Z, symmetric in x (apart from a few
// millimetres of hand-built irregularity). Path runs along -Z through it.
//
// Construction (all procedural, nothing loaded):
//   * hashira  — two round pillars, lathed, tapering 0.50 m -> 0.42 m and leaning
//                very slightly inward (uchikorobi); each a hair different
//   * nemaki   — black-lacquered "kamebara" collars with a bronze band on top,
//                standing on a chamfered granite footing (square slab + turned
//                drum) with moss / dirt / contact shading in vertex colours
//   * nuki     — tie-beam that pierces the pillars, protruding ends with bronze
//                end plates (kakushi) and black kusabi wedge keys
//   * gakuzuka — central strut with a gilded, framed plaque (front and back)
//   * kasagi   — vermilion lintel LOFTED along the myojin upward sweep (sori),
//                ends cut square to the curve
//   * shimaki  — black pitched cap lofted on top of the kasagi
//
// Look: PBR-ish lacquer — painted albedo with wood grain, chalking, rain
// streaks and hairline cracks (all low-frequency, so nothing shimmers while
// the camera dollies), packed bump/roughness maps, a tiny procedural sky
// environment (PMREM, created once per renderer, SPECULAR ONLY so the diffuse
// light stays the shared hemisphere + sun of the rest of the world),
// vertex-colour ambient occlusion/grime and a soft projected ground shadow.
// 7 draw calls (6 + the optional ground decal), ~17.5k triangles, ~5 MB of textures,
// no lights, no shadow maps, nothing per frame.
import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries, toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { WORLD } from "./WorldEnvironment.jsx";
import { mulberry32 } from "./rng.js";

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/* ------------------------------------------------------------------ */
/* Dimensions (metres). Origin at ground centre, front faces +Z.       */
/* ------------------------------------------------------------------ */
const D = {
  padX: 1.82, // pillar centre x at the ground (spacing ~3.6 m at nuki height)
  pillarR0: 0.25, // 0.50 m diameter at the base
  pillarR1: 0.21, // 0.42 m diameter at the top
  pillarTop: 4.0,
  lean: 0.012, // rad — uchikorobi
  nukiY: 3.34,
  nukiH: 0.22,
  nukiD: 0.19,
  nukiHalf: 2.36,
  kasagiY: 3.86, // underside of the kasagi at the centre
  kasagiT: 0.32,
  shimakiT: 0.16,
  kasagiHalf: 2.62,
  shimakiHalf: 2.7, // overall span 5.4 m
  lift: 0.27, // upward sweep of the kasagi tips
};
// The two hashira were never turned on the same lathe: a few millimetres of
// difference in girth and depth, a different slice of the lacquer texture and
// a different amount of weathering keep them from looking like clones.
// Keyed by side (-1 = left when facing the front, +1 = right).
const PILLARS = {
  "-1": { k: 1, dz: -0.0025, uv: [0, 0], wear: 0.0 },
  1: { k: 1.006, dz: 0.004, uv: [0.37, 0.21], wear: 1.0 },
};
const pillarR = (y, k = 1) => mix(D.pillarR0, D.pillarR1, y / D.pillarTop) * k;
const pillarX = (y) => D.padX - Math.sin(D.lean) * y;
const liftAt = (x) => {
  const u = Math.min(Math.abs(x) / 2.7, 1);
  return D.lift * (0.72 * u * u + 0.28 * Math.pow(u, 5));
};
const kasagiBottom = (x) => D.kasagiY + liftAt(x);
const shimakiBottom = (x) => D.kasagiY + D.kasagiT - 0.012 + liftAt(x);

/* ------------------------------------------------------------------ */
/* Periodic value noise for tileable canvas textures                   */
/* ------------------------------------------------------------------ */
function hash2(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const wrap = (i, p) => ((i % p) + p) % p;
function vnoise(x, y, px, py, s) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let xf = x - xi;
  let yf = y - yi;
  xf = xf * xf * (3 - 2 * xf);
  yf = yf * yf * (3 - 2 * yf);
  const x0 = wrap(xi, px);
  const x1 = wrap(xi + 1, px);
  const y0 = wrap(yi, py);
  const y1 = wrap(yi + 1, py);
  const a = hash2(x0, y0, s);
  const b = hash2(x1, y0, s);
  const c = hash2(x0, y1, s);
  const d = hash2(x1, y1, s);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}
function fbmp(x, y, px, py, oct, s) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    sum += vnoise(x * f, y * f, px * f, py * f, s + i * 17) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}
const mkCanvas = (w, h) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};

/* ------------------------------------------------------------------ */
/* Texture painters                                                    */
/* ------------------------------------------------------------------ */

// Vermilion lacquer over wood. Returns an sRGB albedo canvas and a packed
// canvas (R = bump height, G = roughness). Grain runs along the canvas'
// vertical axis; streaks (rain) only make sense on pillars.
function paintLacquer({ seed, streaks, cracks }) {
  const W = 256;
  const H = 512;
  const alb = mkCanvas(W, H);
  const pck = mkCanvas(W, H);
  const actx = alb.getContext("2d");
  const pctx = pck.getContext("2d");
  const ai = actx.createImageData(W, H);
  const pi = pctx.createImageData(W, H);
  const A = ai.data;
  const P = pi.data;
  const base = [200, 46, 27];
  const faded = [208, 78, 46];
  for (let y = 0; y < H; y++) {
    const fy = y / H;
    for (let x = 0; x < W; x++) {
      const fx = x / W;
      const grain = vnoise(fx * 64, fy * 8, 64, 8, seed);
      const pores = vnoise(fx * 128, fy * 20, 128, 20, seed + 7);
      const mid = vnoise(fx * 16, fy * 4, 16, 4, seed + 13);
      const blot = fbmp(fx * 6, fy * 6, 6, 6, 3, seed + 21);
      const weather = smooth(0.5, 0.78, fbmp(fx * 5, fy * 7, 5, 7, 3, seed + 33));
      const line = smooth(0.34, 0.06, pores);
      // (all low-frequency: survives mip-mapping, no shimmer when dollying)
      let tone = 1 + 0.04 * (grain - 0.5) + 0.03 * (pores - 0.5) + 0.06 * (mid - 0.5) + 0.16 * (blot - 0.5) - 0.035 * line;
      const w = weather * 0.22;
      const r = mix(base[0], faded[0], w) * tone;
      const g = mix(base[1], faded[1], w) * tone + 10 * (mid - 0.5);
      const b = mix(base[2], faded[2], w) * tone;
      const i = (y * W + x) * 4;
      A[i] = clamp(r, 0, 255);
      A[i + 1] = clamp(g, 0, 255);
      A[i + 2] = clamp(b, 0, 255);
      A[i + 3] = 255;
      const height = 0.55 + 0.3 * (pores - 0.5) + 0.2 * (grain - 0.5) - 0.18 * line;
      const rough = 0.33 + 0.1 * (blot - 0.5) + 0.2 * weather + 0.08 * (pores - 0.5) + 0.06 * line;
      P[i] = clamp(height, 0, 1) * 255;
      P[i + 1] = clamp(rough, 0.22, 0.8) * 255;
      P[i + 2] = 255;
      P[i + 3] = 255;
    }
  }
  actx.putImageData(ai, 0, 0);
  pctx.putImageData(pi, 0, 0);

  const rnd = mulberry32(seed * 31 + 5);
  // rain streaks: soft dark and pale vertical runs
  for (let k = 0; k < streaks; k++) {
    const x = rnd() * W;
    const y0 = rnd() * H * 0.5;
    const len = 90 + rnd() * 320;
    const wd = 1.5 + rnd() * 4;
    const a = 0.05 + rnd() * 0.1;
    const dark = rnd() < 0.7;
    for (const ox of [-W, 0, W]) {
      const gr = actx.createLinearGradient(0, y0, 0, y0 + len);
      const col = dark ? "70,10,8" : "228,190,170";
      gr.addColorStop(0, `rgba(${col},0)`);
      gr.addColorStop(0.12, `rgba(${col},${a})`);
      gr.addColorStop(0.75, `rgba(${col},${a * 0.7})`);
      gr.addColorStop(1, `rgba(${col},0)`);
      actx.fillStyle = gr;
      actx.fillRect(x + ox - wd / 2, y0, wd, len);
    }
  }
  // hairline cracks running with the grain
  actx.lineWidth = 0.9;
  pctx.lineWidth = 1.4;
  for (let k = 0; k < cracks; k++) {
    let x = rnd() * W;
    let y = rnd() * H * 0.85;
    const segs = 5 + Math.floor(rnd() * 8);
    const pts = [[x, y]];
    for (let s = 0; s < segs; s++) {
      x += (rnd() - 0.5) * 5;
      y += 6 + rnd() * 12;
      pts.push([x, y]);
    }
    actx.strokeStyle = `rgba(52,10,8,${0.2 + rnd() * 0.22})`;
    pctx.strokeStyle = "rgba(20,175,255,0.9)";
    for (const c of [actx, pctx]) {
      c.beginPath();
      c.moveTo(pts[0][0], pts[0][1]);
      for (let s = 1; s < pts.length; s++) c.lineTo(pts[s][0], pts[s][1]);
      c.stroke();
    }
  }
  return { alb, pck };
}

// Weathered granite: warm grey, speckled, with a little lichen.
function paintStone(seed) {
  const S = 256;
  const alb = mkCanvas(S, S);
  const pck = mkCanvas(S, S);
  const actx = alb.getContext("2d");
  const pctx = pck.getContext("2d");
  const ai = actx.createImageData(S, S);
  const pi = pctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const fx = x / S;
      const fy = y / S;
      const big = fbmp(fx * 4, fy * 4, 4, 4, 4, seed);
      const fine = vnoise(fx * 96, fy * 96, 96, 96, seed + 3);
      const mid = fbmp(fx * 16, fy * 16, 16, 16, 3, seed + 9);
      const lich = smooth(0.62, 0.8, fbmp(fx * 6, fy * 6, 6, 6, 3, seed + 41));
      const tone = 0.86 + 0.28 * (big - 0.5) + 0.14 * (fine - 0.5) + 0.12 * (mid - 0.5);
      const i = (y * S + x) * 4;
      ai.data[i] = mix(150, 118, lich) * tone;
      ai.data[i + 1] = mix(145, 124, lich) * tone;
      ai.data[i + 2] = mix(134, 92, lich) * tone;
      ai.data[i + 3] = 255;
      pi.data[i] = clamp(0.5 + 0.28 * (fine - 0.5) + 0.42 * (mid - 0.5), 0, 1) * 255;
      pi.data[i + 1] = clamp(0.86 + 0.1 * (fine - 0.5), 0, 1) * 255;
      pi.data[i + 2] = 255;
      pi.data[i + 3] = 255;
    }
  }
  actx.putImageData(ai, 0, 0);
  pctx.putImageData(pi, 0, 0);
  const rnd = mulberry32(seed + 99);
  for (let k = 0; k < 700; k++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = 0.5 + rnd() * 1.3;
    const light = rnd() < 0.45;
    actx.fillStyle = light ? "rgba(228,222,208,0.5)" : "rgba(56,52,46,0.55)";
    pctx.fillStyle = light ? "rgba(255,150,255,0.7)" : "rgba(40,150,255,0.8)";
    for (const c of [actx, pctx]) {
      c.beginPath();
      c.arc(x, y, r, 0, TAU);
      c.fill();
    }
  }
  return { alb, pck };
}

// Gilded plaque (gaku) with two brush-drawn characters. Atlas: top half =
// front face (with the kasagi's cast shadow baked in), bottom half = rear.
function paintPlaque() {
  const W = 256;
  const H = 288;
  const cv = mkCanvas(W, H * 2);
  const c = cv.getContext("2d");
  const brush = (pts, w0, w1) => {
    c.lineCap = "round";
    c.lineJoin = "round";
    for (let i = 1; i < pts.length; i++) {
      const t = (i - 1) / (pts.length - 1);
      c.lineWidth = mix(w0, w1, t);
      c.beginPath();
      c.moveTo(pts[i - 1][0], pts[i - 1][1]);
      c.lineTo(pts[i][0], pts[i][1]);
      c.stroke();
    }
  };
  const glyphs = [
    // 神
    [
      [[[13, 18], [27, 32]], 9, 6],
      [[[8, 41], [38, 37], [30, 50], [12, 66]], 6, 4],
      [[[26, 50], [26, 88], [21, 92]], 6, 5],
      [[[36, 58], [47, 72]], 6, 5],
      [[[56, 24], [92, 24], [92, 64], [56, 64], [56, 24]], 5.5, 5.5],
      [[[56, 44], [92, 44]], 5.5, 5.5],
      [[[74, 8], [74, 96]], 6, 6],
    ],
    // 社
    [
      [[[13, 18], [27, 32]], 9, 6],
      [[[8, 41], [38, 37], [30, 50], [12, 66]], 6, 4],
      [[[26, 50], [26, 88], [21, 92]], 6, 5],
      [[[36, 58], [47, 72]], 6, 5],
      [[[60, 36], [94, 36]], 6, 6],
      [[[77, 12], [77, 86]], 6.5, 6.5],
      [[[54, 86], [100, 86]], 6.5, 6.5],
    ],
  ];
  for (let face = 0; face < 2; face++) {
    c.save();
    c.translate(0, face * H);
    // lacquered black ground
    const bg = c.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, "#1d1814");
    bg.addColorStop(1, "#110d0b");
    c.fillStyle = bg;
    c.fillRect(0, 0, W, H);
    // gilt inner border (a raised brass frame is modelled around the plaque)
    const gold = c.createLinearGradient(0, 0, W, H);
    gold.addColorStop(0, "#f6d67c");
    gold.addColorStop(0.5, "#d3a544");
    gold.addColorStop(1, "#ecc562");
    c.strokeStyle = gold;
    c.lineWidth = 6;
    c.strokeRect(7, 7, W - 14, H - 14);
    c.lineWidth = 2;
    c.strokeRect(17, 17, W - 34, H - 34);
    // characters: bold gilt strokes so they still glint at 10+ m
    c.strokeStyle = gold;
    for (let g = 0; g < 2; g++) {
      const sc = 1.2;
      const ox = 128 - 54 * sc;
      const oy = 18 + g * 128;
      for (const [pts, w0, w1] of glyphs[g]) {
        brush(
          pts.map(([x, y]) => [ox + x * sc, oy + y * sc]),
          w0 * sc * 1.15,
          w1 * sc * 1.15
        );
      }
    }
    if (face === 0) {
      // shadow the kasagi's overhang throws on the front
      const sh = c.createLinearGradient(0, 0, 0, H * 0.5);
      sh.addColorStop(0, "rgba(0,0,0,0.6)");
      sh.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = sh;
      c.fillRect(0, 0, W, H * 0.5);
    }
    c.restore();
  }
  return cv;
}

// Black lacquer: a roughness map only (G channel). Patchy sheen with faint
// vertical wipe marks, so the collars and the shimaki do not read as one
// uniform sheet of patent leather.
function paintBlackRough() {
  const W = 128;
  const H = 256;
  const cv = mkCanvas(W, H);
  const c = cv.getContext("2d");
  const id = c.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const fx = x / W;
      const fy = y / H;
      const blot = fbmp(fx * 4, fy * 4, 4, 4, 3, 61);
      const wipe = vnoise(fx * 24, fy * 3, 24, 3, 67);
      const dust = vnoise(fx * 40, fy * 40, 40, 40, 71);
      const r = clamp(0.42 + 0.26 * (blot - 0.5) + 0.12 * (wipe - 0.5) + 0.05 * (dust - 0.5), 0.26, 0.7);
      const i = (y * W + x) * 4;
      id.data[i] = id.data[i + 1] = id.data[i + 2] = r * 255;
      id.data[i + 3] = 255;
    }
  }
  c.putImageData(id, 0, 0);
  return cv;
}

// Soft projected shadow of the gate on the ground for WORLD.sunDir, plus
// contact blobs under the plinths. Returns { canvas, x0, z0, w, h }.
const SHADOW = { ppm: 32, x0: -6.5, z0: -6.5, w: 16, h: 8 };
function paintShadow() {
  const S = SHADOW;
  const CW = S.w * S.ppm;
  const CH = S.h * S.ppm;
  const L = WORLD.sunDir;
  const sx = -L[0] / L[1];
  const sz = -L[2] / L[1];
  const proj = (x, y, z) => [(x + sx * y - S.x0) * S.ppm, (z + sz * y - S.z0) * S.ppm];
  const hull = (pts) => {
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [];
    for (const q of p) {
      while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
      lo.push(q);
    }
    const up = [];
    for (let i = p.length - 1; i >= 0; i--) {
      const q = p[i];
      while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
      up.push(q);
    }
    lo.pop();
    up.pop();
    return lo.concat(up);
  };
  const layers = [mkCanvas(CW, CH), mkCanvas(CW, CH)]; // 0 = sharp (low), 1 = soft (high)
  const ctx = layers.map((l) => {
    const c = l.getContext("2d");
    c.fillStyle = "#fff";
    return c;
  });
  const poly = (c, pts) => {
    c.beginPath();
    pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
    c.closePath();
    c.fill();
  };
  // pillars: slice them so the penumbra widens with height
  for (const side of [-1, 1]) {
    const slices = 10;
    for (let k = 0; k < slices; k++) {
      const y0 = 0.2 + (k / slices) * 3.8;
      const y1 = 0.2 + ((k + 1) / slices) * 3.8 + 0.02;
      const r = pillarR((y0 + y1) / 2);
      const a = proj(side * pillarX(y0), y0, 0);
      const b = proj(side * pillarX(y1), y1, 0);
      const c = ctx[y0 < 1.3 ? 0 : 1];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      const nx = (-dy / len) * r * S.ppm;
      const ny = (dx / len) * r * S.ppm;
      poly(c, [
        [a[0] + nx, a[1] + ny],
        [b[0] + nx, b[1] + ny],
        [b[0] - nx, b[1] - ny],
        [a[0] - nx, a[1] - ny],
      ]);
    }
  }
  // nuki
  {
    const pts = [];
    for (const x of [-D.nukiHalf, D.nukiHalf])
      for (const y of [D.nukiY - D.nukiH / 2, D.nukiY + D.nukiH / 2])
        for (const z of [-D.nukiD / 2, D.nukiD / 2]) pts.push(proj(x, y, z));
    poly(ctx[1], hull(pts));
  }
  // kasagi + shimaki: hull per segment along the sweep
  {
    const n = 48;
    for (let i = 0; i < n; i++) {
      const xa = -D.shimakiHalf + (i / n) * 2 * D.shimakiHalf;
      const xb = -D.shimakiHalf + ((i + 1) / n) * 2 * D.shimakiHalf;
      const pts = [];
      for (const x of [xa, xb])
        for (const y of [kasagiBottom(x), shimakiBottom(x) + D.shimakiT])
          for (const z of [-0.27, 0.27]) pts.push(proj(x, y, z));
      poly(ctx[1], hull(pts));
    }
  }
  // gakuzuka
  {
    const pts = [];
    for (const x of [-0.2, 0.2])
      for (const y of [D.nukiY + D.nukiH / 2, D.kasagiY])
        for (const z of [-0.085, 0.085]) pts.push(proj(x, y, z));
    poly(ctx[1], hull(pts));
  }

  const rd = (l) => {
    const d = l.getContext("2d").getImageData(0, 0, CW, CH).data;
    const a = new Float32Array(CW * CH);
    for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3] / 255;
    return a;
  };
  const blur = (a, r) => {
    const tmp = new Float32Array(a.length);
    const inv = 1 / (2 * r + 1);
    for (let y = 0; y < CH; y++) {
      for (let x = 0; x < CW; x++) {
        let s = 0;
        for (let k = -r; k <= r; k++) s += a[y * CW + clamp(x + k, 0, CW - 1)];
        tmp[y * CW + x] = s * inv;
      }
    }
    for (let x = 0; x < CW; x++) {
      for (let y = 0; y < CH; y++) {
        let s = 0;
        for (let k = -r; k <= r; k++) s += tmp[clamp(y + k, 0, CH - 1) * CW + x];
        a[y * CW + x] = s * inv;
      }
    }
  };
  const sharp = rd(layers[0]);
  const soft = rd(layers[1]);
  blur(sharp, 2);
  blur(sharp, 2);
  blur(soft, 4);
  blur(soft, 4);
  blur(soft, 3);

  const out = mkCanvas(CW, CH);
  const oc = out.getContext("2d");
  const id = oc.createImageData(CW, CH);
  // contact darkening blobs under the plinths
  const blobs = [proj(-D.padX, 0, 0), proj(D.padX, 0, 0)];
  for (let y = 0; y < CH; y++) {
    for (let x = 0; x < CW; x++) {
      const i = y * CW + x;
      let a = Math.max(sharp[i], soft[i]);
      for (const b of blobs) {
        const d = Math.hypot(x - b[0], y - b[1]) / (0.95 * S.ppm);
        if (d < 1) a = Math.max(a, 0.55 * Math.pow(1 - d, 1.6));
      }
      const o = i * 4;
      id.data[o] = 54;
      id.data[o + 1] = 56;
      id.data[o + 2] = 78;
      id.data[o + 3] = clamp(a, 0, 1) * 255;
    }
  }
  oc.putImageData(id, 0, 0);
  return out;
}

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                    */
/* ------------------------------------------------------------------ */
const solidColor = (g, r = 1, gg = 1, b = 1) => {
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    c[i * 3] = r;
    c[i * 3 + 1] = gg;
    c[i * 3 + 2] = b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(c, 3));
};
const tint = (g, fn) => {
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const col = fn(p.getX(i), p.getY(i), p.getZ(i), n.getX(i), n.getY(i), n.getZ(i));
    c[i * 3] = col[0];
    c[i * 3 + 1] = col[1];
    c[i * 3 + 2] = col[2];
  }
  g.setAttribute("color", new THREE.BufferAttribute(c, 3));
};
// normalise a geometry to position/normal/uv/color, non-indexed, so it merges
const finalize = (geo) => {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.clearGroups();
  const n = g.attributes.position.count;
  if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.color) solidColor(g);
  for (const k of Object.keys(g.attributes)) if (!["position", "normal", "uv", "color"].includes(k)) g.deleteAttribute(k);
  return g;
};

// chamfered corners of a 2D polygon
function bevelPolygon(pts, c) {
  const out = [];
  const m = pts.length;
  for (let i = 0; i < m; i++) {
    const p = pts[(i + m - 1) % m];
    const v = pts[i];
    const q = pts[(i + 1) % m];
    const d1 = Math.hypot(p[0] - v[0], p[1] - v[1]);
    const d2 = Math.hypot(q[0] - v[0], q[1] - v[1]);
    const c1 = Math.min(c, d1 * 0.45);
    const c2 = Math.min(c, d2 * 0.45);
    out.push([v[0] + ((p[0] - v[0]) / d1) * c1, v[1] + ((p[1] - v[1]) / d1) * c1]);
    out.push([v[0] + ((q[0] - v[0]) / d2) * c2, v[1] + ((q[1] - v[1]) / d2) * c2]);
  }
  return out;
}
const mirrorLoop = (half) => {
  // half = right-hand profile (z >= 0) from bottom to top
  const left = half
    .slice()
    .reverse()
    .map(([z, y]) => [-z, y]);
  return half.concat(left);
};

// Sweep a (z, dy) cross-section along x. `baseY(x)` is the underside of the
// section at station x. Ends may be sheared so they are cut square to the
// curve. Returns { side, caps }.
function loft({ xs, baseY, section, shearEnds = false, colorFn, uvU = 1.6, uvV = 3.0, uvOff = [0, 0] }) {
  const n = section.length;
  const N = xs.length;
  const per = [0];
  for (let j = 1; j <= n; j++) {
    const a = section[j - 1];
    const b = section[j % n];
    per.push(per[j - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const rings = [];
  for (let i = 0; i < N; i++) {
    const x0 = xs[i];
    const y0 = baseY(x0);
    let slope = 0;
    if (shearEnds && (i === 0 || i === N - 1)) slope = (baseY(x0 + 1e-3) - baseY(x0 - 1e-3)) / 2e-3;
    const ring = [];
    for (let j = 0; j < n; j++) {
      const [z, dy] = section[j];
      ring.push([x0 - slope * dy, y0 + dy, z, dy]);
    }
    rings.push(ring);
  }
  const cen = rings.map((r) => {
    let cy = 0;
    let cz = 0;
    for (const v of r) {
      cy += v[1];
      cz += v[2];
    }
    return [cy / r.length, cz / r.length];
  });

  const pos = [];
  const uv = [];
  const col = [];
  const push = (v, u, w) => {
    pos.push(v[0], v[1], v[2]);
    uv.push(u, w);
    const c = colorFn ? colorFn(v[0], v[1], v[2], v[3]) : [1, 1, 1];
    col.push(c[0], c[1], c[2]);
  };
  const tri = (a, b, c, ua, ub, uc, out) => {
    // orient so the normal points away from the section centre
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const nx = e1[1] * e2[2] - e1[2] * e2[1];
    const ny = e1[2] * e2[0] - e1[0] * e2[2];
    const nz = e1[0] * e2[1] - e1[1] * e2[0];
    const my = (a[1] + b[1] + c[1]) / 3 - out[0];
    const mz = (a[2] + b[2] + c[2]) / 3 - out[1];
    if (ny * my + nz * mz < 0) {
      push(a, ua[0], ua[1]);
      push(c, uc[0], uc[1]);
      push(b, ub[0], ub[1]);
    } else {
      push(a, ua[0], ua[1]);
      push(b, ub[0], ub[1]);
      push(c, uc[0], uc[1]);
    }
  };
  const uvOf = (i, j) => [per[j] / uvU + uvOff[0], (xs[i] - xs[0]) / uvV + uvOff[1]];
  for (let i = 0; i < N - 1; i++) {
    for (let j = 0; j < n; j++) {
      const j1 = (j + 1) % n;
      const a = rings[i][j];
      const b = rings[i][j1];
      const c = rings[i + 1][j1];
      const d = rings[i + 1][j];
      const ua = uvOf(i, j);
      const ub = uvOf(i, j + 1);
      const uc = uvOf(i + 1, j + 1);
      const ud = uvOf(i + 1, j);
      tri(a, b, c, ua, ub, uc, cen[i]);
      tri(a, c, d, ua, uc, ud, cen[i]);
    }
  }
  const side = new THREE.BufferGeometry();
  side.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  side.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  side.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  toCreasedNormals(side, 0.9);

  // end caps (flat, separate geometry so they can use the black lacquer)
  const cpos = [];
  const cuv = [];
  const ccol = [];
  for (const i of [0, N - 1]) {
    const dir = i === 0 ? -1 : 1;
    const r = rings[i];
    const cx = r.reduce((s, v) => s + v[0], 0) / r.length;
    const cyy = cen[i][0];
    const czz = cen[i][1];
    for (let j = 0; j < n; j++) {
      const a = [cx, cyy, czz];
      const b = r[j];
      const c = r[(j + 1) % n];
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const nx = e1[1] * e2[2] - e1[2] * e2[1];
      const order = nx * dir >= 0 ? [a, b, c] : [a, c, b];
      for (const v of order) {
        cpos.push(v[0], v[1], v[2]);
        cuv.push(v[2] * 2, v[1] * 2);
        ccol.push(1, 1, 1);
      }
    }
  }
  const caps = new THREE.BufferGeometry();
  caps.setAttribute("position", new THREE.Float32BufferAttribute(cpos, 3));
  caps.setAttribute("uv", new THREE.Float32BufferAttribute(cuv, 2));
  caps.setAttribute("color", new THREE.Float32BufferAttribute(ccol, 3));
  caps.computeVertexNormals();
  return { side, caps };
}

// A box with softly bevelled edges, centred on the origin.
function bevelBox(w, h, d, b, seg = 2) {
  const hw = w / 2 - b;
  const hh = h / 2 - b;
  const s = new THREE.Shape();
  s.moveTo(-hw, -hh);
  s.lineTo(hw, -hh);
  s.lineTo(hw, hh);
  s.lineTo(-hw, hh);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth: d - 2 * b,
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: seg,
    curveSegments: 1,
    steps: 1,
  });
  g.translate(0, 0, -(d - 2 * b) / 2);
  toCreasedNormals(g, 0.95);
  return g;
}

// Lathe with an irregular (hand-cut) radius — for the granite footing.
function wobble(g, seed, amt) {
  const p = g.attributes.position;
  const ph1 = seed * 1.7;
  const ph2 = seed * 3.1;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const a = Math.atan2(z, x);
    const k = 1 + amt * (Math.sin(3 * a + ph1) * 0.6 + Math.sin(5 * a + ph2) * 0.4);
    p.setX(i, x * k);
    p.setZ(i, z * k);
  }
}

/* ------------------------------------------------------------------ */
/* Building all geometry                                               */
/* ------------------------------------------------------------------ */
// smooth, non-periodic noise (0..1) for vertex-colour grime
const gn = (a, b, s) => vnoise(a, b, 4096, 4096, s);

// A few millimetres of hand-cut irregularity. A pure function of position, so
// vertices that share a corner move together and the mesh stays watertight.
function jitter(g, amt, seed) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    p.setXYZ(
      i,
      x + amt * Math.sin(9.1 * y + 5.3 * z + seed),
      y + amt * 0.6 * Math.sin(7.7 * x + 6.1 * z + seed * 1.3),
      z + amt * Math.sin(8.3 * x + 4.9 * y + seed * 2.1)
    );
  }
}

// Box-projected UVs: the projection plane follows each vertex' dominant normal axis.
function boxProject(g, scale, ox = 0, oy = 0) {
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const az = Math.abs(n.getZ(i));
    let u;
    let v;
    if (ay >= ax && ay >= az) {
      u = p.getX(i);
      v = p.getZ(i);
    } else if (ax >= az) {
      u = p.getZ(i);
      v = p.getY(i);
    } else {
      u = p.getX(i);
      v = p.getY(i);
    }
    uv.setXY(i, u / scale + ox, v / scale + oy);
  }
}

// Vertex-colour grime for the granite footing (geometry is in the footing's
// local frame, y absolute): mud/dust splashed up from the ground, moss
// creeping up the lowest part of the slab and pooling on damp upward faces,
// and contact shading where the collar meets the drum.
const footTint = (seed) => (x, y, z, nx, ny) => {
  const n1 = gn(x * 4.3 + z * 2.1, y * 3.4 + z * 1.3, seed);
  const n2 = gn(x * 13 - z * 9, y * 11 + x * 5, seed + 5);
  const nn = n1 * 0.7 + n2 * 0.3;
  const r = Math.hypot(x, z);
  const up = smooth(0.4, 0.9, ny);
  const splash = 1 - smooth(0.0, 0.17, y);
  const mossy = 0.95 * (1 - smooth(0.02, 0.14, y)) + (y < 0.16 ? 0.42 * up * smooth(0.36, 0.52, r) : 0);
  const moss = clamp(smooth(0.36, 0.6, nn) * mossy * 1.15, 0, 0.9);
  const dirt = clamp(splash * (0.3 + 0.55 * n2), 0, 0.7);
  let k = 1 - 0.22 * splash;
  if (y > 0.19) k *= 1 - 0.6 * smooth(0.42, 0.335, r) * up; // collar sits in the drum's contact shadow
  const c = [k, k, k];
  const mix3 = (t, amt) => {
    c[0] *= mix(1, t[0], amt);
    c[1] *= mix(1, t[1], amt);
    c[2] *= mix(1, t[2], amt);
  };
  mix3([0.7, 0.63, 0.54], dirt);
  mix3([0.6, 0.84, 0.4], moss);
  return c;
};


function buildGeometry() {
  const redPillar = [];
  const redBeam = [];
  const black = [];
  const stone = [];
  const brass = [];

  const nukiLo = D.nukiY - D.nukiH / 2;
  const nukiHi = D.nukiY + D.nukiH / 2;

  /* ---- pillars, collars, footings ---- */
  // a low "turtle belly" bulge that tapers almost straight up to a small lip
  const nemakiProfile = [
    [0.3, 0.19],
    [0.316, 0.22],
    [0.322, 0.26],
    [0.318, 0.32],
    [0.308, 0.4],
    [0.297, 0.5],
    [0.288, 0.62],
    [0.28, 0.74],
    [0.277, 0.8],
    [0.28, 0.835],
    [0.288, 0.853],
    [0.291, 0.868],
    [0.285, 0.884],
    [0.262, 0.895],
    [0.235, 0.895],
  ];
  // thin bronze band (kakushi) resting on the collar's lip, hugging the shaft
  const ringProfile = [
    [0.243, 0.868],
    [0.28, 0.87],
    [0.292, 0.882],
    [0.294, 0.898],
    [0.287, 0.911],
    [0.262, 0.917],
    [0.243, 0.917],
  ];
  // turned stone drum (kamebara-ishi) standing on the square slab
  const drumProfile = [
    [0.41, 0.085],
    [0.444, 0.105],
    [0.452, 0.13],
    [0.45, 0.17],
    [0.44, 0.2],
    [0.424, 0.216],
    [0.4, 0.222],
    [0.365, 0.222],
    [0.33, 0.222],
    [0.26, 0.222],
  ];

  for (const side of [-1, 1]) {
    const P = PILLARS[side];
    // shaft, collar and ring lean together (uchikorobi); footing stays level
    const place = (g) => {
      g.rotateZ(side * D.lean);
      g.translate(side * D.padX, 0, P.dz);
      return g;
    };

    // vermilion shaft
    const pts = [];
    const steps = 16;
    for (let k = 0; k <= steps; k++) {
      const y = mix(0.78, D.pillarTop, k / steps);
      // barely-there entasis so the taper is not a mechanical cone
      pts.push(new THREE.Vector2(pillarR(y, P.k) + 0.004 * Math.sin((k / steps) * Math.PI), y));
    }
    let g = finalize(new THREE.LatheGeometry(pts, 48));
    {
      const p = g.attributes.position;
      const uv = g.attributes.uv;
      for (let i = 0; i < p.count; i++) uv.setXY(i, uv.getX(i) + P.uv[0], p.getY(i) / 3.0 + P.uv[1]);
    }
    tint(g, (x, y, z) => {
      // rising damp / road dust: a broken, noisy edge rather than a clean gradient
      const dn = gn(x * 6 + z * 4 + side * 5, y * 2.2, 57);
      const dirt = Math.exp(-(y - 0.85) / (0.3 + 0.4 * dn));
      let k = 1 - 0.4 * dirt;
      k *= 1 - 0.4 * smooth(3.45, 4.0, y);
      k *= 1 - 0.12 * (1 - smooth(0.1, 0.45, Math.abs(y - D.nukiY)));
      // slow, large-scale tone drift and a touch more sun-fade on the right pillar
      k *= 0.93 + 0.14 * gn(x * 3.1 + z * 1.9 + side * 7, y * 1.3, 91);
      k *= 1 - 0.05 * P.wear * smooth(1.2, 3.2, y);
      return [k * (1 - 0.1 * dirt), k * (1 - 0.2 * dirt), k * (1 - 0.28 * dirt)];
    });
    redPillar.push(place(g));

    // black kamebara / nemaki collar
    g = finalize(new THREE.LatheGeometry(nemakiProfile.map(([r, y]) => new THREE.Vector2(r, y)), 48));
    tint(g, (x, y, z, nx, ny) => {
      // road dust splashed up the bell and settled on its upward faces
      const n1 = gn(x * 7 + z * 5 + side * 3, y * 3.2, 31);
      const splash = Math.exp(-(y - 0.19) / 0.14);
      const dust = clamp(splash * (0.3 + 0.9 * n1) + 0.45 * smooth(0.3, 0.9, ny) * n1, 0, 1);
      return [1 + 0.9 * dust, 1 + 0.7 * dust, 1 + 0.4 * dust];
    });
    black.push(place(g));

    // bronze band
    g = finalize(new THREE.LatheGeometry(ringProfile.map(([r, y]) => new THREE.Vector2(r, y)), 48));
    brass.push(place(g));

    // granite footing, part 1: a square slab, sunk into the ground and a hair off-square
    let slab = finalize(bevelBox(0.98, 0.16, 0.98, 0.022, 2));
    slab.translate(0, 0.03, 0);
    jitter(slab, 0.003, side * 3.7);
    boxProject(slab, 0.9, side * 0.31, side * 0.17);
    tint(slab, footTint(31 + side * 7));
    slab.rotateY(side * 0.035);
    slab.translate(side * D.padX + side * 0.004, 0, P.dz);
    stone.push(slab);

    // granite footing, part 2: the turned drum with a chamfered ledge
    let drum = new THREE.LatheGeometry(drumProfile.map(([r, y]) => new THREE.Vector2(r, y)), 44);
    wobble(drum, side + 3, 0.03);
    drum = toCreasedNormals(finalize(drum), 0.6);
    {
      const p = drum.attributes.position;
      const n = drum.attributes.normal;
      const uv = drum.attributes.uv;
      for (let i = 0; i < p.count; i++) {
        if (n.getY(i) > 0.7) uv.setXY(i, p.getX(i) / 0.9 + side, p.getZ(i) / 0.9);
        // 3 whole tiles round the drum, so the angular seam is invisible
        else uv.setXY(i, (Math.atan2(p.getZ(i), p.getX(i)) / TAU) * 3 + side * 0.4, p.getY(i) / 0.9);
      }
    }
    tint(drum, footTint(53 + side * 5));
    drum.translate(side * D.padX, 0, P.dz);
    stone.push(drum);
  }


  /* ---- kasagi and shimaki (lofted along the sori) ---- */
  const chebyshev = (half, n) => {
    const xs = [];
    for (let i = 0; i < n; i++) xs.push(-half * Math.cos((Math.PI * i) / (n - 1)));
    return xs;
  };
  {
    const T = D.kasagiT;
    const half = [
      [0.215, 0],
      [0.24, 0.03],
      [0.25, 0.1],
      [0.255, 0.2],
      [0.247, 0.29],
      [0.232, T],
    ];
    let section = mirrorLoop(half);
    // start with the bottom-left so the loop is closed properly
    section = bevelPolygon(bevelPolygon(section, 0.012), 0.004);
    const { side, caps } = loft({
      xs: chebyshev(D.kasagiHalf, 47),
      baseY: kasagiBottom,
      section,
      shearEnds: true,
      colorFn: (x, y, z, dy) => {
        let k = 1 - 0.34 * (1 - smooth(0, 0.13, dy));
        k *= 1 - 0.15 * smooth(T - 0.05, T, dy);
        return [k, k, k];
      },
      uvU: 1.7,
      uvV: 3.0,
      uvOff: [0.31, 0.12],
    });
    redBeam.push(finalize(side));
    {
      const cg = finalize(caps);
      solidColor(cg, 0.62, 0.55, 0.52);
      redBeam.push(cg);
    }
  }
  {
    const T = D.shimakiT;
    const half = [
      [0.262, 0],
      [0.276, 0.035],
      [0.268, 0.062],
      [0.13, 0.128],
      [0.085, T],
    ];
    let section = mirrorLoop(half);
    section = bevelPolygon(bevelPolygon(section, 0.012), 0.004);
    const { side, caps } = loft({
      xs: chebyshev(D.shimakiHalf, 47),
      baseY: shimakiBottom,
      section,
      shearEnds: true,
      colorFn: (x, y, z, dy) => {
        const k = 1 - 0.3 * (1 - smooth(0, 0.05, dy));
        return [k, k, k];
      },
    });
    black.push(finalize(side));
    black.push(finalize(caps));
  }

  /* ---- nuki, bronze end plates, kusabi ---- */
  {
    const hd = D.nukiD / 2;
    const section = bevelPolygon(
      [
        [-hd, 0],
        [hd, 0],
        [hd, D.nukiH],
        [-hd, D.nukiH],
      ],
      0.02
    );
    const { side } = loft({
      xs: [-D.nukiHalf, -1.3, 0, 1.3, D.nukiHalf],
      baseY: () => nukiLo,
      section,
      colorFn: (x, y, z, dy) => {
        const k = 1 - 0.32 * (1 - smooth(0, 0.07, dy));
        return [k, k, k];
      },
      uvU: 1.2,
      uvV: 3.0,
      uvOff: [0.6, 0.4],
    });
    redBeam.push(finalize(side));

    for (const s of [-1, 1]) {
      // bronze cap (kakushi): a chamfered plate with a slightly raised, darker boss
      const plate = finalize(bevelBox(0.02, D.nukiH + 0.03, D.nukiD + 0.03, 0.007, 2));
      plate.translate(s * (D.nukiHalf + 0.006), D.nukiY, 0);
      brass.push(plate);
      const boss = finalize(bevelBox(0.012, D.nukiH - 0.03, D.nukiD - 0.03, 0.005, 1));
      solidColor(boss, 0.72, 0.68, 0.62);
      boss.translate(s * (D.nukiHalf + 0.018), D.nukiY, 0);
      brass.push(boss);
    }
  }
  // kusabi — black wedge keys hugging both sides of each pillar where the nuki
  // passes through: tall against the shaft, sloping away, dipping a little
  // below the nuki
  for (const side of [-1, 1]) {
    const P = PILLARS[side];
    const xc = side * pillarX(D.nukiY);
    const R = pillarR(D.nukiY, P.k);
    for (const dir of [-1, 1]) {
      const o = side * dir; // world x direction of this wedge (dir 1 = outboard)
      const b = 0.007;
      const depth = 0.14;
      const y0 = nukiLo - 0.04;
      const yTop = nukiHi + 0.105;
      const yLow = nukiHi + 0.05;
      const X = (u) => o * (R + u);
      const s = new THREE.Shape();
      s.moveTo(X(-0.014 + b), y0 + b);
      s.lineTo(X(0.05 - b), y0 + b);
      s.lineTo(X(0.088 - b), yLow - b);
      s.lineTo(X(-0.014 + b), yTop - b);
      s.closePath();
      const g = new THREE.ExtrudeGeometry(s, {
        depth: depth - 2 * b,
        bevelEnabled: true,
        bevelThickness: b,
        bevelSize: b,
        bevelSegments: 1,
        curveSegments: 1,
      });
      g.translate(xc, 0, -(depth - 2 * b) / 2 + P.dz);
      toCreasedNormals(g, 0.95);
      const f = finalize(g);
      tint(f, (x, y) => {
        const k = 1 - 0.2 * (1 - smooth(nukiHi - 0.02, nukiHi + 0.07, y));
        return [k, k, k];
      });
      black.push(f);
    }
  }

  /* ---- gakuzuka strut ---- */
  {
    const h = D.kasagiY - nukiHi + 0.02;
    const g = bevelBox(0.46, h, 0.17, 0.014);
    g.translate(0, nukiHi - 0.005 + h / 2, 0);
    const f = finalize(g);
    const p = f.attributes.position;
    const uv = f.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + p.getZ(i)) / 1.7 + 0.5, p.getY(i) / 3.0);
    tint(f, (x, y, z, nx, ny, nz) => {
      // kasagi overhang shades the top of the strut; nuki shades the foot
      let k = 1 - 0.42 * smooth(D.kasagiY - 0.2, D.kasagiY, y) * (nz > 0.5 ? 1 : 0.6);
      k *= 1 - 0.18 * (1 - smooth(nukiHi, nukiHi + 0.08, y));
      return [k, k, k];
    });
    redBeam.push(f);
  }

  /* ---- plaque (gaku): black lacquer pane + raised brass frame, front and rear ---- */
  const plaque = [];
  {
    const fw = 0.36; // frame outer size
    const fh = 0.4;
    const ft = 0.014; // frame bar width
    const cy = nukiHi + 0.006 + fh / 2;
    const zf = 0.085; // gakuzuka face
    for (const face of [0, 1]) {
      const zs = face === 0 ? 1 : -1;
      const g = finalize(new THREE.PlaneGeometry(fw - 2 * ft + 0.006, fh - 2 * ft + 0.006));
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * 0.5 + (face === 0 ? 0.5 : 0));
      if (face === 1) g.rotateY(Math.PI);
      g.translate(0, cy, zs * (zf + 0.003));
      plaque.push(g);
      for (const [w, h, x, y] of [
        [fw, ft, 0, (fh - ft) / 2],
        [fw, ft, 0, -(fh - ft) / 2],
        [ft, fh - 2 * ft + 0.004, (fw - ft) / 2, 0],
        [ft, fh - 2 * ft + 0.004, -(fw - ft) / 2, 0],
      ]) {
        const bar = finalize(bevelBox(w, h, 0.012, 0.0045, 1));
        bar.translate(x, cy + y, zs * (zf + 0.006));
        brass.push(bar);
      }
    }
  }

  /* ---- ground shadow decal (built at y = 0; the mesh lifts it clear of the paving) ---- */
  const shadow = new THREE.PlaneGeometry(SHADOW.w, SHADOW.h);
  shadow.rotateX(-Math.PI / 2);
  shadow.translate(SHADOW.x0 + SHADOW.w / 2, 0, SHADOW.z0 + SHADOW.h / 2);


  const merge = (list) => {
    const m = mergeGeometries(list, false);
    list.forEach((g) => g.dispose());
    return m;
  };
  return {
    pillars: merge(redPillar),
    beams: merge(redBeam),
    black: merge(black),
    stone: merge(stone),
    brass: merge(brass),
    plaque: merge(plaque),
    shadow,
  };
}

/* ------------------------------------------------------------------ */
/* Tiny procedural sky environment for lacquer reflections             */
/* ------------------------------------------------------------------ */
// Returns a PMREM render target, or null when the device cannot build one
// (no half-float render targets, context lost, ...): the gate then simply has
// no sky sheen instead of taking the whole canvas down.
function makeEnv(gl) {
  try {
    return buildEnv(gl);
  } catch (e) {
    return null;
  }
}
function buildEnv(gl) {
  const w = 128;
  const h = 64;
  const data = new Uint16Array(w * h * 4);
  const top = new THREE.Color(WORLD.skyTop);
  const hor = new THREE.Color(WORLD.skyHorizon);
  const gnd = new THREE.Color("#b3a48e");
  const sun = new THREE.Color(WORLD.sun);
  const sd = new THREE.Vector3(...WORLD.sunDir).normalize();
  const dir = new THREE.Vector3();
  const c = new THREE.Color();
  const H = THREE.DataUtils.toHalfFloat;
  for (let j = 0; j < h; j++) {
    const lat = ((j + 0.5) / h - 0.5) * Math.PI;
    const sy = Math.sin(lat);
    const cy = Math.cos(lat);
    for (let i = 0; i < w; i++) {
      const phi = ((i + 0.5) / w - 0.5) * TAU;
      dir.set(Math.cos(phi) * cy, sy, Math.sin(phi) * cy);
      if (sy >= 0) c.copy(hor).lerp(top, smooth(0, 0.75, sy));
      else c.copy(hor).lerp(gnd, smooth(0, 0.3, -sy));
      const s = Math.max(dir.dot(sd), 0);
      const boost = Math.pow(s, 36) * 5 + Math.pow(s, 5) * 0.45;
      const k = (j * w + i) * 4;
      data[k] = H(c.r + sun.r * boost);
      data[k + 1] = H(c.g + sun.g * boost);
      data[k + 2] = H(c.b + sun.b * boost);
      data[k + 3] = H(1);
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  const pmrem = new THREE.PMREMGenerator(gl);
  const rt = pmrem.fromEquirectangular(tex);
  pmrem.dispose();
  tex.dispose();
  return rt;
}

/* ------------------------------------------------------------------ */
/* Shared, ref-counted resource bundle (one per renderer)              */
/* ------------------------------------------------------------------ */
const bundles = new Map();

function buildBundle(gl) {
  const own = [];
  const track = (o) => {
    own.push(o);
    return o;
  };
  const aniso = Math.min(8, gl.capabilities.getMaxAnisotropy());
  const canvasTex = (cv, srgb) => {
    const t = track(new THREE.CanvasTexture(cv));
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    return t;
  };

  // The probe is used for SPECULAR reflections only: strip its diffuse
  // irradiance so the gate is lit by the same hemisphere + sun as the rest of
  // the world (otherwise it glows a little and the black lacquer greys out).
  const specOnly = (mat) => {
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <lights_fragment_maps>",
        THREE.ShaderChunk.lights_fragment_maps.replace(/iblIrradiance\s*\+=\s*getIBLIrradiance\(\s*geometry\.normal\s*\)\s*;/, "")
      );
    };
    mat.customProgramCacheKey = () => "toriiGate-specOnly";
    return mat;
  };

  const lacP = paintLacquer({ seed: 11, streaks: 38, cracks: 16 });
  const lacB = paintLacquer({ seed: 23, streaks: 5, cracks: 9 });
  const stn = paintStone(5);
  const envRT = makeEnv(gl);
  if (envRT) track(envRT);
  const env = envRT ? envRT.texture : null;

  const pillarTex = canvasTex(lacP.alb, true);
  const pillarPack = canvasTex(lacP.pck, false);
  const beamTex = canvasTex(lacB.alb, true);
  const beamPack = canvasTex(lacB.pck, false);
  const stoneTex = canvasTex(stn.alb, true);
  const stonePack = canvasTex(stn.pck, false);
  const blackRough = canvasTex(paintBlackRough(), false);
  const plaqueTex = canvasTex(paintPlaque(), true);
  plaqueTex.wrapS = plaqueTex.wrapT = THREE.ClampToEdgeWrapping;
  const shadowTex = canvasTex(paintShadow(), true);
  shadowTex.wrapS = shadowTex.wrapT = THREE.ClampToEdgeWrapping;

  const lacquer = (map, pack) =>
    track(
      specOnly(
        new THREE.MeshStandardMaterial({
          map,
          roughnessMap: pack,
          roughness: 1,
          bumpMap: pack,
          bumpScale: 0.0035,
          metalness: 0,
          vertexColors: true,
          envMap: env,
          envMapIntensity: 0.45,
        })
      )
    );
  const mats = {
    pillar: lacquer(pillarTex, pillarPack),
    beam: lacquer(beamTex, beamPack),
    // black lacquer: satin rather than patent leather (patchy roughness map,
    // toned-down sky sheen) so the collars stop showing one hard white dot
    black: track(
      specOnly(
        new THREE.MeshStandardMaterial({
          color: "#1a1511",
          roughness: 1,
          roughnessMap: blackRough,
          metalness: 0,
          vertexColors: true,
          envMap: env,
          envMapIntensity: 0.5,
        })
      )
    ),
    // granite: matte, no reflections needed
    stone: track(
      new THREE.MeshStandardMaterial({
        map: stoneTex,
        roughnessMap: stonePack,
        roughness: 1,
        bumpMap: stonePack,
        bumpScale: 0.006,
        vertexColors: true,
      })
    ),
    // aged bronze rather than bright brass (calmer from every angle)
    brass: track(
      specOnly(
        new THREE.MeshStandardMaterial({
          color: "#98723a",
          roughness: 0.5,
          metalness: 0.62,
          vertexColors: true,
          envMap: env,
          envMapIntensity: 0.75,
        })
      )
    ),
    plaque: track(
      specOnly(
        new THREE.MeshStandardMaterial({
          map: plaqueTex,
          roughness: 0.42,
          metalness: 0.0,
          envMap: env,
          envMapIntensity: 0.6,
        })
      )
    ),
    shadow: track(
      new THREE.MeshBasicMaterial({
        map: shadowTex,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      })
    ),
  };
  const geos = buildGeometry();
  Object.values(geos).forEach(track);
  return { geos, mats, refs: 0, own };
}

function acquire(gl) {
  let b = bundles.get(gl);
  if (!b) {
    b = buildBundle(gl);
    bundles.set(gl, b);
  }
  return b;
}
function release(gl, b) {
  b.refs--;
  if (b.refs > 0) return;
  // defer so React StrictMode's unmount/remount does not throw the bundle away
  setTimeout(() => {
    if (b.refs > 0 || bundles.get(gl) !== b) return;
    bundles.delete(gl);
    b.own.forEach((o) => o.dispose && o.dispose());
    // textures referenced by materials
    Object.values(b.mats).forEach((m) => {
      for (const k of ["map", "roughnessMap", "bumpMap"]) if (m[k]) m[k].dispose();
    });
  }, 0);
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */
// Props: position / rotation / scale as usual. `groundShadow` toggles the baked sun shadow
// decal; `shadowY` is the height (m, gate-local) it floats at — just above the
// cambered sando paving (0.03-0.06) and the verge (<= ~0.075).
export default function ToriiGate({ position = [0, 0, 0], rotation = [0, 0, 0], scale = 1, groundShadow = true, shadowY = 0.08 }) {
  const gl = useThree((s) => s.gl);
  const b = useMemo(() => acquire(gl), [gl]);
  useEffect(() => {
    b.refs++;
    return () => release(gl, b);
  }, [gl, b]);

  const { geos, mats } = b;
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh geometry={geos.pillars} material={mats.pillar} />
      <mesh geometry={geos.beams} material={mats.beam} />
      <mesh geometry={geos.black} material={mats.black} />
      <mesh geometry={geos.stone} material={mats.stone} />
      <mesh geometry={geos.brass} material={mats.brass} />
      <mesh geometry={geos.plaque} material={mats.plaque} />
      {groundShadow && <mesh geometry={geos.shadow} material={mats.shadow} position={[0, shadowY, 0]} renderOrder={2} />}
    </group>
  );
}
