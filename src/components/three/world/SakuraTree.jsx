// SakuraTree - a Somei-Yoshino style blossoming cherry tree, grown procedurally.
//
//   * bark      one merged mesh: flared trunk with buttress lobes + surface roots, 3-4 arching
//               main limbs (forks staggered along the trunk top, fork collars, rounded tips),
//               secondary / tertiary branches and fine twigs (tapered tubes, vertex-colour AO +
//               moss + dark crotches, tiling dark-bark lenticel texture)
//   * blossoms  one mesh of camera-facing quads (billboarded in the vertex shader). Every
//               quad carries a cluster of ~500 tiny 5-petal flowers from a code-built
//               atlas (alpha-tested / alpha-to-coverage on MSAA canvases, coverage-preserving
//               mips). Shading is done in the fragment shader from a "crown volume" normal +
//               a puff normal, so the crown reads lit on top, warm pink underneath and
//               translucent when backlit - no shadow maps, no extra lights. Gentle wind in
//               the vertex shader, driven by one uniform updated in Material.onBeforeRender.
//   * ground    (quality >= 0.5) one small transparent mesh: soft contact shadow, a dappled
//               warm-neutral crown shadow thrown along the world sun direction, a drift of
//               fallen petals painted into a 1024x512 atlas.
//
// Geometry / textures / materials are built once and shared through refcounted
// module-level caches (key = seed + quantised quality). Per tree cost = 3 draw calls
// (2 below quality 0.5).
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { mulberry32, makeNoise2D, fbm } from "./rng.js";
import { WORLD } from "./WorldEnvironment.jsx";

// ---------------------------------------------------------------------------
// tunables
// ---------------------------------------------------------------------------
const MAX_SPRITES = 2300; // blossom quads at quality 1 (2 triangles each)
const SIZE_EXP = 0.3; // sprite growth at low quality: size *= (1/q)^SIZE_EXP (keeps crowns full, saves fill)
const GROUND_MIN_Q = 0.5; // below this quality no ground decal (saves a draw call on far trees)

const V = THREE.Vector3;
const TAU = Math.PI * 2;
const UP = new V(0, 1, 0);
const X_AXIS = new V(1, 0, 0);
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const SUN = new V(...WORLD.sunDir).normalize();

// ---------------------------------------------------------------------------
// bark texture (tileable, greyscale multiplier): dark grey-brown plates, deep
// vertical fissures, rows of pale horizontal lenticels with a dark lower lip
// ---------------------------------------------------------------------------
function buildBarkTexture() {
  const S = 256;
  const rnd = mulberry32(777);
  const mk = (n) => {
    const g = new Float32Array(n * n);
    for (let i = 0; i < g.length; i++) g[i] = rnd();
    return g;
  };
  const vn = (g, n, x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const x0 = ((xi % n) + n) % n;
    const y0 = ((yi % n) + n) % n;
    const x1 = (x0 + 1) % n;
    const y1 = (y0 + 1) % n;
    const a = g[y0 * n + x0];
    const b = g[y0 * n + x1];
    const c = g[y1 * n + x0];
    const d = g[y1 * n + x1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const gA = mk(8);
  const gB = mk(32);
  const gC = mk(64);
  const gV = mk(48);
  const val = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const fx = x / S;
      const fy = y / S;
      // vertical fissures: thin dark ridges between scaly plates
      const fis = smooth(0.58, 0.8, vn(gV, 48, fx * 48, fy * 3.5));
      val[y * S + x] =
        0.5 +
        (vn(gA, 8, fx * 8, fy * 8) - 0.5) * 0.3 +
        (vn(gB, 32, fx * 32, fy * 5) - 0.5) * 0.24 +
        (vn(gC, 64, fx * 64, fy * 64) - 0.5) * 0.12 -
        fis * 0.2;
    }
  }
  // lenticels: pale horizontal dashes in loose rows, each with a dark lower lip
  for (let k = 0; k < 150; k++) {
    const row = Math.floor(rnd() * 18);
    const cx = rnd() * S;
    const cy = (row + rnd() * 0.5) * (S / 18);
    const len = 12 + rnd() * 44;
    const th = 1.3 + rnd() * 2.2;
    const hi = 0.26 + rnd() * 0.24;
    for (let dy = -Math.ceil(th) - 3; dy <= Math.ceil(th) + 3; dy++) {
      for (let dx = -Math.ceil(len / 2); dx <= Math.ceil(len / 2); dx++) {
        const along = 1 - Math.pow(Math.abs(dx) / (len / 2), 2.2);
        if (along <= 0) continue;
        const across = Math.abs(dy) / th;
        let add = 0;
        if (across < 1) add = hi * along * (1 - across * across);
        else if (dy > 0 && dy < th + 3) add = -0.22 * along * (1 - (dy - th) / 3);
        if (add === 0) continue;
        const px = (((Math.round(cx + dx) % S) + S) % S) | 0;
        const py = (((Math.round(cy + dy) % S) + S) % S) | 0;
        val[py * S + px] += add;
      }
    }
  }
  // short dark cracks, mostly vertical
  for (let k = 0; k < 40; k++) {
    const cx = rnd() * S;
    const cy = rnd() * S;
    const len = 10 + rnd() * 34;
    for (let dy = 0; dy <= len; dy++) {
      const px = (((Math.round(cx + Math.sin(dy * 0.2 + k) * 1.1) % S) + S) % S) | 0;
      const py = (((Math.round(cy + dy) % S) + S) % S) | 0;
      val[py * S + px] -= 0.26 * Math.sin((dy / len) * Math.PI);
    }
  }
  const data = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    const v = Math.round(clamp(val[i], 0.1, 1) * 255);
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// blossom atlas: 2x2 tiles of 512px, every tile a puffy cluster of tiny
// 5-petal flowers. Channels (data, not colour):
//   R = pinkness 0..1 (white -> deep pink)   G = petal shade   B = kind
//   (0 petal, ~0.45 flower centre, 1 leaf)   A = coverage (alpha tested)
// ---------------------------------------------------------------------------
const ATLAS = 1024;
const TILE = 512;

function makeFlowerStamps(rnd) {
  // stamp = { w, h, d: Uint8Array(w*h*4) }  (a, pink, shade, kind) already at final pixel size
  const stamps = [];
  const sizes = [8.4, 10.0, 11.8];
  for (const R of sizes) {
    for (let v = 0; v < 6; v++) {
      const w = Math.ceil(R * 2 + 3);
      const d = new Uint8Array(w * w * 4);
      const rot = rnd() * TAU;
      const squash = 0.82 + rnd() * 0.18;
      const sr = rnd() * TAU;
      const c = w / 2;
      for (let y = 0; y < w; y++) {
        for (let x = 0; x < w; x++) {
          let dx = x + 0.5 - c;
          let dy = y + 0.5 - c;
          // squash along an axis to fake a tilted flower
          const ca0 = Math.cos(sr);
          const sa0 = Math.sin(sr);
          const ux = dx * ca0 + dy * sa0;
          const uy = (-dx * sa0 + dy * ca0) / squash;
          dx = ux;
          dy = uy;
          const r = Math.hypot(dx, dy);
          const th = Math.atan2(dy, dx) - rot;
          const seg = TAU / 5;
          const phi = (((th % seg) + seg) % seg) - seg / 2;
          const notch = 1 - 0.13 * Math.exp(-Math.pow(phi / 0.16, 2));
          const edge = R * (0.68 + 0.32 * Math.cos(phi * 2.5)) * notch;
          const a = clamp(edge - r + 0.5, 0, 1);
          if (a <= 0) continue;
          const rn = r / edge;
          const gap = Math.exp(-Math.pow((Math.abs(phi) - seg / 2) / 0.1, 2)) * smooth(0.95, 0.15, rn);
          const shade = clamp(0.62 + 0.38 * smooth(0.1, 0.95, rn) - 0.3 * gap - 0.16 * smooth(0.8, 1.0, rn), 0, 1);
          const pink = 0.36 * Math.pow(1 - clamp(rn, 0, 1), 1.6);
          const kind = r < R * 0.17 ? 0.45 : 0;
          const o = (y * w + x) * 4;
          d[o] = Math.round(a * 255);
          d[o + 1] = Math.round(pink * 255);
          d[o + 2] = Math.round(shade * 255);
          d[o + 3] = Math.round(kind * 255);
        }
      }
      stamps.push({ w, d, size: R });
    }
  }
  // small buds (elongated, pinker)
  for (let v = 0; v < 6; v++) {
    const R = 6;
    const w = Math.ceil(R * 2 + 3);
    const d = new Uint8Array(w * w * 4);
    const rot = rnd() * TAU;
    const c = w / 2;
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x + 0.5 - c;
        const dy = y + 0.5 - c;
        const ux = dx * Math.cos(rot) + dy * Math.sin(rot);
        const uy = -dx * Math.sin(rot) + dy * Math.cos(rot);
        const e = Math.hypot(ux / R, uy / (R * 0.55));
        const a = clamp((1 - e) * R * 0.55 + 0.5, 0, 1);
        if (a <= 0) continue;
        const o = (y * w + x) * 4;
        d[o] = Math.round(a * 255);
        d[o + 1] = Math.round(0.3 * 255);
        d[o + 2] = Math.round((0.55 + 0.4 * (1 - e)) * 255);
        d[o + 3] = 0;
      }
    }
    stamps.push({ w, d, size: R, bud: true });
  }
  return stamps;
}

function makeLeafStamps(rnd) {
  const out = [];
  for (let v = 0; v < 5; v++) {
    const L = 8 + rnd() * 4;
    const W = L * (0.34 + rnd() * 0.1);
    const w = Math.ceil(L * 2 + 3);
    const d = new Uint8Array(w * w * 4);
    const rot = rnd() * TAU;
    const c = w / 2;
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x + 0.5 - c;
        const dy = y + 0.5 - c;
        const ux = dx * Math.cos(rot) + dy * Math.sin(rot);
        const uy = -dx * Math.sin(rot) + dy * Math.cos(rot);
        const s = clamp(ux / L, -1, 1); // -1 .. 1 along the leaf
        const half = W * Math.pow(Math.max(0, 1 - s * s), 0.7) * (s > 0 ? 1 : 0.85);
        const a = clamp(half - Math.abs(uy) + 0.5, 0, 1);
        if (a <= 0) continue;
        const o = (y * w + x) * 4;
        d[o] = Math.round(a * 255);
        d[o + 1] = 0;
        d[o + 2] = Math.round(clamp(0.5 + 0.5 * (1 - Math.abs(uy) / Math.max(0.5, half)) - 0.15 * Math.abs(s), 0, 1) * 255);
        d[o + 3] = 255;
      }
    }
    out.push({ w, d, leaf: true });
  }
  return out;
}

// composite one stamp into the atlas (premultiplied-correct "over")
function blit(data, stamp, cx, cy, pink, bright, leafMix) {
  const { w, d } = stamp;
  const x0 = Math.round(cx - w / 2);
  const y0 = Math.round(cy - w / 2);
  for (let y = 0; y < w; y++) {
    const ty = y0 + y;
    if (ty < 0 || ty >= ATLAS) continue;
    for (let x = 0; x < w; x++) {
      const tx = x0 + x;
      if (tx < 0 || tx >= ATLAS) continue;
      const so = (y * w + x) * 4;
      const sa = d[so] / 255;
      if (sa <= 0) continue;
      const o = (ty * ATLAS + tx) * 4;
      const da = data[o + 3] / 255;
      const oa = sa + da * (1 - sa);
      let r;
      let g;
      let b;
      if (stamp.leaf) {
        r = leafMix * 255;
        g = d[so + 2] * bright;
        b = 255;
      } else {
        r = clamp(pink + d[so + 1] / 255, 0, 1) * 255;
        g = d[so + 2] * bright;
        b = d[so + 3];
      }
      const wn = sa / oa;
      data[o] = data[o] * (1 - wn) + r * wn;
      data[o + 1] = data[o + 1] * (1 - wn) + g * wn;
      data[o + 2] = data[o + 2] * (1 - wn) + b * wn;
      data[o + 3] = Math.round(oa * 255);
    }
  }
}

function buildBlossomAtlas() {
  const rnd = mulberry32(31415);
  const flowers = makeFlowerStamps(rnd);
  const leaves = makeLeafStamps(rnd);
  const petals = flowers.filter((s) => !s.bud);
  const buds = flowers.filter((s) => s.bud);
  const data = new Uint8Array(ATLAS * ATLAS * 4);
  const noise = makeNoise2D(2718);

  for (let tile = 0; tile < 4; tile++) {
    const ox = (tile % 2) * TILE;
    const oy = Math.floor(tile / 2) * TILE;
    const half = TILE / 2;
    // lobes of the cluster
    const lobes = [];
    const nl = 4 + Math.floor(rnd() * 3);
    for (let l = 0; l < nl; l++) {
      const a = rnd() * TAU;
      const d = Math.pow(rnd(), 0.8) * 0.5;
      lobes.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r: 0.42 + rnd() * 0.24 });
    }
    lobes.push({ x: 0, y: 0, r: 0.5 });
    const nOff = rnd() * 50;
    const list = [];
    const attempts = 5200;
    for (let k = 0; k < attempts; k++) {
      const u = (rnd() * 2 - 1) * 0.94;
      const v = (rnd() * 2 - 1) * 0.94;
      let dens = 0;
      for (const lb of lobes) {
        const dd = Math.hypot(u - lb.x, v - lb.y) / lb.r;
        dens = Math.max(dens, 1 - dd);
      }
      if (dens <= 0) continue;
      const hole = fbm(noise, u * 2.4 + nOff, v * 2.4 + nOff * 0.7, 3);
      // ragged, holey rim; dense core
      const p = Math.pow(clamp(dens * 1.5, 0, 1), 1.15) * smooth(0.22, 0.42, hole + dens * 0.25);
      if (rnd() > p) continue;
      list.push({ u, v, dens });
    }
    // draw in random order so flowers interleave
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = list[i];
      list[i] = list[j];
      list[j] = t;
    }
    for (const f of list) {
      const cx = ox + half + f.u * half * 0.98;
      const cy = oy + half + f.v * half * 0.98;
      // pinkness: clumps of whiter / pinker flowers
      const clump = fbm(noise, f.u * 3.1 + nOff * 2, f.v * 3.1 + 9 + nOff, 3) - 0.5;
      const pr = rnd();
      let pink = pr < 0.36 ? 0.02 + rnd() * 0.18 : pr < 0.76 ? 0.22 + rnd() * 0.26 : 0.46 + rnd() * 0.3;
      pink = clamp(pink + clump * 0.45, 0, 0.95);
      const bright = 0.8 + rnd() * 0.2;
      const rr = rnd();
      if (rr < 0.07) {
        blit(data, buds[Math.floor(rnd() * buds.length)], cx, cy, clamp(pink + 0.22, 0, 1), bright, 0);
      } else if (rr < 0.077 && f.dens < 0.45) {
        blit(data, leaves[Math.floor(rnd() * leaves.length)], cx, cy, 0, 0.75 + rnd() * 0.25, rnd());
      } else {
        blit(data, petals[Math.floor(rnd() * petals.length)], cx, cy, pink, bright, 0);
      }
    }
  }

  // transparent texels carry a mid pink instead of zeros, so bilinear filtering at a
  // cluster edge blends towards pink rather than towards white (pinkness 0) or black
  for (let i = 0; i < ATLAS * ATLAS; i++) {
    const o = i * 4;
    if (data[o + 3] === 0) {
      data[o] = 92;
      data[o + 1] = 168;
      data[o + 2] = 0;
    }
  }

  // ----- coverage preserving mip chain -----
  let cov = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] >= 128) cov++;
  const cov0 = cov / (ATLAS * ATLAS);
  const mips = [{ data, width: ATLAS, height: ATLAS }];
  let w = ATLAS;
  let scale = 1;
  while (w > 1) {
    const nw = w >> 1;
    const src = mips[mips.length - 1].data;
    const dst = new Uint8Array(nw * nw * 4);
    const af = new Float32Array(nw * nw);
    const hist = new Uint32Array(256);
    for (let y = 0; y < nw; y++) {
      for (let x = 0; x < nw; x++) {
        let sa = 0;
        let sr = 0;
        let sg = 0;
        let sb = 0;
        for (let k = 0; k < 4; k++) {
          const o = ((2 * y + (k >> 1)) * w + 2 * x + (k & 1)) * 4;
          const a = src[o + 3];
          sa += a;
          sr += src[o] * a;
          sg += src[o + 1] * a;
          sb += src[o + 2] * a;
        }
        const o2 = (y * nw + x) * 4;
        if (sa > 0) {
          dst[o2] = sr / sa;
          dst[o2 + 1] = sg / sa;
          dst[o2 + 2] = sb / sa;
        }
        const a = sa / 4;
        af[y * nw + x] = a;
        hist[Math.min(255, Math.round(a))]++;
      }
    }
    // pick alpha scale so that the alpha>=0.5 fraction stays cov0
    if (nw >= 8) {
      const target = cov0 * nw * nw;
      let acc = 0;
      let v = 255;
      for (; v > 0; v--) {
        acc += hist[v];
        if (acc >= target) break;
      }
      scale = clamp(127.5 / Math.max(v, 8), 1, 4);
    }
    for (let i = 0; i < nw * nw; i++) dst[i * 4 + 3] = Math.min(255, Math.round(af[i] * scale));
    mips.push({ data: dst, width: nw, height: nw });
    w = nw;
  }

  const tex = new THREE.DataTexture(data, ATLAS, ATLAS, THREE.RGBAFormat);
  tex.mipmaps = mips;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// ground decal atlas (1024 x 512, sRGB, painted once):
//   [   0..511] x [0..511]   drift of fallen petals + a pink haze  (7.2 m square)
//   [ 512..767] x [0..255]   soft warm contact shadow
//   [ 512..1023] x [256..511] dappled, warm-neutral crown shadow
//   [ 768..831] x [0..63]    opaque block (single fallen petals sample it)
// ---------------------------------------------------------------------------
const DECAL_W = 1024;
const DECAL_H = 512;
const DECAL_DRIFT_M = 7.2;

function paintDecal(ctx) {
  const rnd = mulberry32(5150);
  const noise = makeNoise2D(9001);
  const pm = 512 / DECAL_DRIFT_M; // pixels per metre in the drift cell

  // ---- petal drift -------------------------------------------------------
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, 512, 512);
  ctx.clip();
  let g = ctx.createRadialGradient(256, 256, 0, 256, 256, 3.3 * pm);
  g.addColorStop(0, "rgba(246,192,212,0.18)");
  g.addColorStop(0.55, "rgba(246,196,214,0.11)");
  g.addColorStop(1, "rgba(246,200,216,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  const cols = ["#fdf0f4", "#fbe1e9", "#f7cdda", "#f3bccd", "#fff5f8", "#efaac1"];
  const petal = (x, y, a) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rnd() * TAU);
    ctx.fillStyle = cols[Math.floor(rnd() * cols.length)];
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.ellipse(0, 0, 2.6 + rnd() * 1.8, 1.4 + rnd() * 0.8, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  };
  for (let i = 0; i < 2800; i++) {
    const a = rnd() * TAU;
    const d = 3.5 * rnd();
    const x = 256 + Math.cos(a) * d * pm;
    const y = 256 + Math.sin(a) * d * pm;
    const patch = smooth(0.3, 0.66, fbm(noise, x * 0.014 + 3, y * 0.014 + 8, 3));
    if (rnd() > 0.3 + 0.7 * patch) continue;
    petal(x, y, 0.78 * (1 - smooth(2.2, 3.55, d)));
  }
  for (let c = 0; c < 38; c++) {
    const a = rnd() * TAU;
    const d = Math.sqrt(rnd()) * 3.1;
    const cx = Math.cos(a) * d;
    const cy = Math.sin(a) * d;
    const rad = 0.22 + rnd() * 0.5;
    const n = 26 + Math.floor(rnd() * 60);
    for (let i = 0; i < n; i++) {
      const aa = rnd() * TAU;
      const dd = Math.sqrt(rnd()) * rad;
      petal(256 + (cx + Math.cos(aa) * dd) * pm, 256 + (cy + Math.sin(aa) * dd) * pm, 0.82 * (1 - smooth(2.6, 3.6, d)));
    }
  }
  ctx.restore();

  // ---- contact shadow ----------------------------------------------------
  g = ctx.createRadialGradient(640, 128, 0, 640, 128, 124);
  g.addColorStop(0, "rgba(30,22,24,0.62)");
  g.addColorStop(0.35, "rgba(30,22,24,0.34)");
  g.addColorStop(1, "rgba(30,22,24,0)");
  ctx.fillStyle = g;
  ctx.fillRect(512, 0, 256, 256);

  // ---- dappled crown shadow (a 2:1 ellipse) ------------------------------
  ctx.save();
  ctx.beginPath();
  ctx.rect(512, 256, 512, 256);
  ctx.clip();
  ctx.translate(768, 384);
  ctx.scale(2, 1);
  g = ctx.createRadialGradient(0, 0, 0, 0, 0, 124);
  g.addColorStop(0, "rgba(40,32,34,0.29)");
  g.addColorStop(0.55, "rgba(40,32,34,0.22)");
  g.addColorStop(1, "rgba(40,32,34,0)");
  ctx.fillStyle = g;
  ctx.fillRect(-128, -128, 256, 256);
  for (let i = 0; i < 60; i++) {
    const a = rnd() * TAU;
    const d = Math.sqrt(rnd()) * 92;
    const x = Math.cos(a) * d;
    const y = Math.sin(a) * d;
    const r = 10 + rnd() * 22;
    const dark = rnd() < 0.45;
    const gg = ctx.createRadialGradient(x, y, 0, x, y, r);
    gg.addColorStop(0, dark ? "rgba(34,28,30,0.10)" : "rgba(0,0,0,0.16)");
    gg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalCompositeOperation = dark ? "source-over" : "destination-out";
    ctx.fillStyle = gg;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.restore();

  // ---- opaque petal block --------------------------------------------------
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(768, 0, 64, 64);
}

function buildDecalTexture() {
  const W = DECAL_W;
  const H = DECAL_H;
  const data = new Uint8Array(W * H * 4);
  let painted = false;
  if (typeof document !== "undefined") {
    try {
      const cv = document.createElement("canvas");
      cv.width = W;
      cv.height = H;
      const ctx = cv.getContext("2d", { willReadFrequently: true });
      if (ctx) {
        paintDecal(ctx);
        data.set(ctx.getImageData(0, 0, W, H).data);
        painted = true;
      }
    } catch (e) {
      painted = false;
    }
  }
  if (painted) {
    // canvases hand back premultiplied-then-unpremultiplied colours; wherever the
    // alpha is (nearly) zero the colour is noise, so pin it to the region's tone
    // (keeps linear filtering from pulling dark fringes into the petals)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4;
        if (data[o + 3] >= 40) continue;
        if (x < 512) {
          data[o] = 246;
          data[o + 1] = 204;
          data[o + 2] = 219;
        } else {
          data[o] = 36;
          data[o + 1] = 28;
          data[o + 2] = 30;
        }
      }
    }
  } else {
    for (let y = 0; y < 64; y++) {
      for (let x = 768; x < 832; x++) {
        const o = (y * W + x) * 4;
        data[o] = data[o + 1] = data[o + 2] = data[o + 3] = 255;
      }
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// shared materials
// ---------------------------------------------------------------------------
const blossomVertex = /* glsl */ `
  attribute vec2 aCorner;
  attribute vec4 aInfo;   // size, roll, tile, pink bias
  attribute vec2 aShade;  // ao, sway
  uniform float uTime;
  varying vec2 vUv;
  varying vec2 vQ;
  varying vec3 vNw;
  varying vec3 vWp;
  varying vec2 vInfo;
  #include <common>
  #include <fog_pars_vertex>
  void main() {
    vec3 c = position;
    vec4 w4 = modelMatrix * vec4(c, 1.0);
    float ph = w4.x * 0.31 + w4.z * 0.23 + w4.y * 0.11;
    float sw = aShade.y;
    c += vec3(
      sin(uTime * 1.05 + ph) * 0.65 + sin(uTime * 2.3 + ph * 2.1) * 0.22,
      sin(uTime * 1.6 + ph * 1.3) * 0.16,
      cos(uTime * 0.85 + ph * 1.7) * 0.5 + cos(uTime * 2.0 + ph * 1.4) * 0.18
    ) * 0.03 * sw;
    vec4 mvPosition = modelViewMatrix * vec4(c, 1.0);
    float sc = length(modelViewMatrix[0].xyz);
    // far crowns: flowers shrink below a pixel, so the cards grow a little and
    // the tree keeps reading as one dense pink cloud instead of thinning out
    float dist = max(-mvPosition.z, 0.1);
    float comp = 1.0 + 0.36 * smoothstep(18.0, 95.0, dist);
    float roll = aInfo.y;
    float cr = cos(roll);
    float sr = sin(roll);
    vec2 q = vec2(aCorner.x * cr - aCorner.y * sr, aCorner.x * sr + aCorner.y * cr);
    mvPosition.xy += q * (aInfo.x * 0.5 * sc * comp);
    gl_Position = projectionMatrix * mvPosition;
    vec2 tileOrigin = vec2(mod(aInfo.z, 2.0), floor(aInfo.z * 0.5));
    vUv = (tileOrigin + mix(vec2(0.02), vec2(0.98), aCorner * 0.5 + 0.5)) * 0.5;
    vQ = q;
    vNw = normalize(mat3(modelMatrix) * normal);
    vWp = (modelMatrix * vec4(c, 1.0)).xyz;
    vInfo = vec2(aShade.x, aInfo.w);
    #include <fog_vertex>
  }
`;

const blossomFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uA2C;
  uniform vec3 uSunDir;
  uniform vec3 uSunCol;
  uniform vec3 uShadeCol;
  uniform vec3 uBounce;
  uniform vec3 uC0;
  uniform vec3 uC1;
  uniform vec3 uC2;
  uniform vec3 uC3;
  uniform vec3 uC4;
  uniform vec3 uCentre;
  uniform vec3 uLeafA;
  uniform vec3 uLeafB;
  varying vec2 vUv;
  varying vec2 vQ;
  varying vec3 vNw;
  varying vec3 vWp;
  varying vec2 vInfo;
  #include <common>
  #include <fog_pars_fragment>

  vec3 ramp(float p) {
    p = clamp(p, 0.0, 1.0) * 4.0;
    vec3 c = mix(uC0, uC1, clamp(p, 0.0, 1.0));
    c = mix(c, uC2, clamp(p - 1.0, 0.0, 1.0));
    c = mix(c, uC3, clamp(p - 2.0, 0.0, 1.0));
    c = mix(c, uC4, clamp(p - 3.0, 0.0, 1.0));
    return c;
  }

  void main() {
    vec4 t = texture2D(uMap, vUv);
    // hard alpha test without MSAA; with MSAA the same edge becomes a soft
    // alpha-to-coverage ramp (no crawling stipple on far crowns)
    float a = mix(step(0.5, t.a), smoothstep(0.46, 0.62, t.a), uA2C);
    if (a < 0.02) discard;

    // volume normal: crown normal bent by a little sphere per puff
    vec3 R = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 U = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec3 F = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
    vec2 pq = vQ * 0.8;
    float r2 = min(dot(pq, pq), 1.0);
    vec3 pn = R * pq.x + U * pq.y + F * sqrt(1.0 - r2);
    vec3 n = normalize(normalize(vNw) * 0.92 + pn * 0.2);

    float ndl = dot(n, uSunDir);
    float sun = smoothstep(-0.35, 0.9, ndl);
    float hemi = 0.5 + 0.5 * n.y;
    float ao = vInfo.x;
    float shade = t.g;

    float pink = 0.05 + t.r * 0.7 + vInfo.y + (1.0 - sun) * 0.1 + (1.0 - ao) * 0.14 + (0.55 - shade) * 0.2;
    vec3 albedo = ramp(pink);
    float leaf = smoothstep(0.7, 0.9, t.b);
    float cen = smoothstep(0.2, 0.4, t.b) * (1.0 - leaf);
    albedo = mix(albedo, uCentre, cen * 0.55);
    vec3 leafCol = mix(uLeafA, uLeafB, t.r) * (0.8 + 0.4 * shade);
    albedo = mix(albedo, leafCol, leaf);

    // sunlit clumps go to the sun colour, shaded ones to a warm pink bounce
    // (petals light each other) - never to grey
    vec3 light = mix(uShadeCol, uSunCol, sun) * mix(0.86, 1.0, hemi);
    float occl = mix(0.62, 1.0, ao) * mix(0.84, 1.0, shade);
    vec3 col = albedo * light * occl;
    col += albedo * uBounce * (1.0 - sun) * mix(0.55, 1.0, ao) * 0.07;

    // translucent petals glow when the sun is behind them
    vec3 V = normalize(cameraPosition - vWp);
    float back = pow(clamp(dot(-V, uSunDir) * 0.5 + 0.5, 0.0, 1.0), 3.0) * (1.0 - sun * 0.6);
    col += albedo * vec3(1.0, 0.66, 0.74) * back * 0.3 * mix(0.5, 1.0, ao);

    // soft shoulder so bright clumps do not clip flat
    vec3 hi = max(col - 0.9, 0.0);
    col = min(col, vec3(0.9)) + 0.1 * (1.0 - exp(-hi * 6.0));

    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

function createShared() {
  const barkTex = buildBarkTexture();
  const blossomTex = buildBlossomAtlas();
  const decalTex = buildDecalTexture();

  const bark = new THREE.MeshLambertMaterial({ vertexColors: true, map: barkTex });

  const col = (h) => new THREE.Color(h);
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uMap: { value: blossomTex },
      uTime: { value: 0 },
      uA2C: { value: 0 },
      uSunDir: { value: SUN.clone() },
      uSunCol: { value: new THREE.Color().setRGB(1.0, 0.97, 0.92) },
      uShadeCol: { value: col("#f0d6df") },
      uBounce: { value: col("#f08fb1") },
      uC0: { value: col("#fff6f8") },
      uC1: { value: col("#fdeef2") },
      uC2: { value: col("#f6cbd8") },
      uC3: { value: col("#f0a6c1") },
      uC4: { value: col("#e48dae") },
      uCentre: { value: col("#dc7096") },
      uLeafA: { value: col("#9a7350") },
      uLeafB: { value: col("#a3bb6a") },
    },
  ]);
  const blossom = new THREE.ShaderMaterial({
    vertexShader: blossomVertex,
    fragmentShader: blossomFragment,
    uniforms,
    fog: true,
    side: THREE.DoubleSide,
  });
  let msaa = null;
  blossom.onBeforeRender = (renderer) => {
    uniforms.uTime.value = (typeof performance !== "undefined" ? performance.now() : Date.now()) * 0.001;
    if (msaa === null) {
      // alpha-to-coverage only means something on a multisampled canvas
      msaa = false;
      try {
        const gl = renderer.getContext();
        msaa = gl.getParameter(gl.SAMPLES) > 1;
      } catch (e) {
        msaa = false;
      }
      blossom.alphaToCoverage = msaa;
      uniforms.uA2C.value = msaa ? 1 : 0;
    }
  };

  const ground = new THREE.MeshBasicMaterial({
    map: decalTex,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

  return { barkTex, blossomTex, decalTex, bark, blossom, ground };
}

function destroyShared(s) {
  s.barkTex.dispose();
  s.blossomTex.dispose();
  s.decalTex.dispose();
  s.bark.dispose();
  s.blossom.dispose();
  s.ground.dispose();
}

// ---------------------------------------------------------------------------
// tiny refcounted cache (survives React StrictMode's mount/unmount/mount)
// ---------------------------------------------------------------------------
function makeCache(create, destroy) {
  const map = new Map();
  const schedule = (e) => {
    clearTimeout(e.timer);
    e.timer = setTimeout(() => {
      if (e.refs <= 0 && map.get(e.key) === e) {
        map.delete(e.key);
        destroy(e.value);
      }
    }, 4000);
  };
  return {
    get(key) {
      let e = map.get(key);
      if (!e) {
        e = { key, value: create(key), refs: 0, timer: 0 };
        map.set(key, e);
        schedule(e);
      }
      return e;
    },
    retain(e) {
      e.refs++;
      clearTimeout(e.timer);
      if (map.get(e.key) !== e) map.set(e.key, e);
    },
    release(e) {
      e.refs--;
      if (e.refs <= 0) schedule(e);
    },
  };
}

const sharedCache = makeCache(createShared, destroyShared);

// ---------------------------------------------------------------------------
// geometry helpers
// ---------------------------------------------------------------------------
class MeshBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
    this.count = 0;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(new THREE.BufferAttribute(this.count > 65000 ? new Uint32Array(this.idx) : new Uint16Array(this.idx), 1));
    g.computeBoundingSphere();
    return g;
  }
}

const _T = new V();
const _n = new V();
const _b = new V();
const _d = new V();

// One tapered tube along a polyline. Options:
//   collar: { k, len }  radius flare at the start (fork collar where a branch leaves its parent)
//   cap:    1 | 2       close the far end: 1 = cone tip (fine twigs), 2 = rounded end (limbs)
//   color(px,py,pz,nx,ny,nz,t,dist)  vertex colour
function addTube(mb, ptsIn, radiiIn, sides, o) {
  let pts = ptsIn;
  let radii = radiiIn;
  if (o.cap) {
    const n0 = pts.length;
    const tl = new V().subVectors(pts[n0 - 1], pts[n0 - 2]).normalize();
    const re = radii[n0 - 1];
    if (o.cap === 1) {
      // fine twigs: one collapsed ring = a cone tip
      pts = pts.concat([pts[n0 - 1].clone().addScaledVector(tl, re * 1.1)]);
      radii = radii.concat([Math.max(0.0007, re * 0.12)]);
    } else {
      // limbs: a rounded, closed end (never a hollow sawn-off tube)
      pts = pts.concat([pts[n0 - 1].clone().addScaledVector(tl, re * 0.75), pts[n0 - 1].clone().addScaledVector(tl, re * 1.3)]);
      radii = radii.concat([re * 0.7, Math.max(0.0007, re * 0.1)]);
    }
  }
  const n = pts.length;
  const arc = new Array(n).fill(0);
  for (let i = 1; i < n; i++) arc[i] = arc[i - 1] + pts[i].distanceTo(pts[i - 1]);
  if (o.collar) radii = radii.map((r, i) => r * (1 + o.collar.k * Math.exp(-arc[i] / o.collar.len)));
  const tang = new Array(n);
  for (let i = 0; i < n; i++) tang[i] = new V().subVectors(pts[Math.min(i + 1, n - 1)], pts[Math.max(i - 1, 0)]).normalize();
  _n.crossVectors(Math.abs(tang[0].y) > 0.92 ? X_AXIS : UP, tang[0]).normalize();
  const base = mb.count;
  for (let i = 0; i < n; i++) {
    const dist = arc[i];
    _T.copy(tang[i]);
    _n.addScaledVector(_T, -_n.dot(_T)).normalize();
    _b.crossVectors(_T, _n);
    const slope =
      i < n - 1
        ? (radii[i + 1] - radii[i]) / Math.max(1e-4, pts[i + 1].distanceTo(pts[i]))
        : (radii[i] - radii[i - 1]) / Math.max(1e-4, pts[i].distanceTo(pts[i - 1]));
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * TAU;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      _d.set(_n.x * ca + _b.x * sa, _n.y * ca + _b.y * sa, _n.z * ca + _b.z * sa);
      const r = radii[i] * (o.radiusMod ? o.radiusMod(i, _d) : 1);
      const px = pts[i].x + _d.x * r;
      const py = pts[i].y + _d.y * r;
      const pz = pts[i].z + _d.z * r;
      let nx = _d.x - _T.x * slope;
      let ny = _d.y - _T.y * slope;
      let nz = _d.z - _T.z * slope;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl;
      ny /= nl;
      nz /= nl;
      mb.pos.push(px, py, pz);
      mb.nor.push(nx, ny, nz);
      mb.uv.push((j / sides) * o.repU, dist / o.vLen);
      const c = o.color(px, py, pz, nx, ny, nz, i / (n - 1), dist);
      mb.col.push(c[0], c[1], c[2]);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < sides; j++) {
      const a = base + i * (sides + 1) + j;
      const b = a + 1;
      const c = a + sides + 1;
      const d = c + 1;
      mb.idx.push(a, b, c, b, d, c);
    }
  }
  mb.count += n * (sides + 1);
}

function polyAt(pts, t) {
  const f = clamp(t, 0, 1) * (pts.length - 1);
  const i = Math.min(pts.length - 2, Math.floor(f));
  const u = f - i;
  return {
    p: new V().lerpVectors(pts[i], pts[i + 1], u),
    tan: new V().subVectors(pts[i + 1], pts[i]).normalize(),
  };
}

const pathLen = (pts) => {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += pts[i].distanceTo(pts[i - 1]);
  return s;
};

function growPath(start, dir, len, segs, trop, rnd, minY) {
  const pts = [start.clone()];
  const d = dir.clone().normalize();
  const step = len / segs;
  for (let i = 0; i < segs; i++) {
    const s = (i + 0.5) / segs;
    const p = pts[i];
    const rl = Math.hypot(p.x, p.z) || 1;
    d.x += (p.x / rl) * trop.out * 0.32 + (rnd() - 0.5) * trop.curl * 2;
    d.z += (p.z / rl) * trop.out * 0.32 + (rnd() - 0.5) * trop.curl * 2;
    d.y += trop.up * 0.3 * (1 - s) - trop.droop * 0.36 * s * s + (rnd() - 0.5) * trop.curl;
    if (p.y < minY) d.y += 0.4;
    d.normalize();
    pts.push(p.clone().addScaledVector(d, step));
  }
  return pts;
}

// ---------------------------------------------------------------------------
// the tree
// ---------------------------------------------------------------------------
const C = (h) => new THREE.Color(h);
// bark: dark grey-brown, multiplied with the tiling lenticel texture; fine twigs are
// reddish-brown like real cherry shoots
const BARK_TRUNK = C("#8c766c");
const BARK_LIMB = C("#8f7a70");
const BARK_TWIG = C("#86604f");
const MOSS = C("#5f6b3f");

const LEVELS = {
  1: { w: 0.3, t0: 0.72 }, // main limbs only host blossoms near their tips
  2: { trop: { up: 0.3, out: 0.5, droop: 0.65, curl: 0.09 }, segs: 4, sides: 5, rmax: 0.06, w: 0.55, t0: 0.3 },
  3: { trop: { up: 0.2, out: 0.25, droop: 1.0, curl: 0.13 }, segs: 3, sides: 4, rmax: 0.026, w: 1.0, t0: 0.12 },
  4: { trop: { up: 0.1, out: 0.1, droop: 0.6, curl: 0.22 }, segs: 2, sides: 3, rmax: 0.012, w: 1.5, t0: 0.0 },
};

function buildTree(seed, q) {
  const rnd = mulberry32((((seed | 0) * 1013904223 + 0x2545f491) >>> 0) || 1);
  for (let i = 0; i < 8; i++) rnd();
  const R = (a, b) => a + (b - a) * rnd();
  const noise = makeNoise2D((((seed | 0) * 31 + 7) >>> 0) || 1);
  const nz3 = (x, y, z) => fbm(noise, x * 0.55 + y * 0.31 + 11, z * 0.55 + y * 0.47 + 5, 3);

  const branches = [];
  const addBranch = (pts, r0, r1, level, sides, rP) => {
    const b = { pts, r0, r1, level, sides, rP, kids: false, len: pathLen(pts), w: LEVELS[level] ? LEVELS[level].w : 1, t0: LEVELS[level] ? LEVELS[level].t0 : 0 };
    branches.push(b);
    return b;
  };

  // ---- trunk ----
  const hf = R(2.0, 2.6);
  const rBase = R(0.24, 0.3);
  const rFork = rBase * R(0.62, 0.72);
  const leanAz = R(0, TAU);
  const leanAmt = R(0.1, 0.32);
  const wobPh = R(0, TAU);
  const trunkAt = (h) => {
    const s = clamp(h / hf, 0, 1.2);
    return new V(
      Math.cos(leanAz) * leanAmt * s * s + Math.sin(h * 2.1 + wobPh) * 0.035 * s,
      h,
      Math.sin(leanAz) * leanAmt * s * s + Math.cos(h * 1.7 + wobPh) * 0.035 * s
    );
  };
  const nb = 3 + (rnd() < 0.5 ? 1 : 0);
  const lobeAz = [];
  const lobeBase = R(0, TAU);
  for (let k = 0; k < nb; k++) lobeAz.push(lobeBase + (k * TAU) / nb + R(-0.3, 0.3));

  const trunkSides = q > 0.65 ? 14 : 8;
  const trunkH = [-0.15, 0.0, 0.1, 0.24, 0.45, 0.8, 1.25, 1.7, hf, hf + 0.16];
  const trunkPts = trunkH.map(trunkAt);
  const trunkR = trunkH.map(
    (h) => lerp(rBase, rFork, smooth(0, 1, h / hf)) * (1 + 0.42 * Math.exp(-Math.max(h, 0) / 0.34)) * (h > hf ? 0.6 : 1)
  );

  // ---- main limbs (forks staggered along the top of the trunk, like a real vase-shaped crown) ----
  const nLimbs = 3 + (rnd() < 0.6 ? 1 : 0);
  const limbAz0 = R(0, TAU);
  const limbs = [];
  for (let k = 0; k <= nLimbs; k++) {
    const leader = k === nLimbs;
    const az = leader ? R(0, TAU) : limbAz0 + (k * TAU) / nLimbs + R(-0.35, 0.35);
    const e0 = leader ? R(0.08, 0.2) : R(0.45, 0.8);
    const e1 = leader ? R(0.35, 0.6) : R(1.1, 1.5);
    const len = leader ? R(3.6, 4.4) : R(3.7, 4.8);
    const startH = hf - (leader ? 0 : R(0.05, 0.9));
    const segs = q > 0.6 ? 8 : 6;
    const start = trunkAt(startH);
    const pts = [start.clone()];
    const ph = R(0, TAU);
    const step = len / segs;
    for (let i = 0; i < segs; i++) {
      const s = (i + 0.5) / segs;
      const e = lerp(e0, e1, Math.pow(s, 0.95));
      const a = az + Math.sin(s * 3.3 + ph) * 0.4;
      const d = new V(Math.sin(e) * Math.cos(a), Math.cos(e), Math.sin(e) * Math.sin(a));
      const np = pts[i].clone().addScaledVector(d, step);
      if (i < segs - 1) {
        np.x += (rnd() - 0.5) * 0.2;
        np.z += (rnd() - 0.5) * 0.2;
      }
      pts.push(np);
    }
    const r0 = leader ? 0.09 : R(0.125, 0.16);
    limbs.push(addBranch(pts, r0, 0.02, 1, q > 0.6 ? 8 : 6, rFork));
  }

  const spawn = (parent, count, level, tMin, tMax, lenRange, angRange) => {
    const L = LEVELS[level];
    const phi0 = R(0, TAU);
    const kids = [];
    parent.kids = true;
    for (let i = 0; i < count; i++) {
      const t = clamp(tMin + (tMax - tMin) * ((i + 0.5) / count) + R(-0.04, 0.04), 0.05, 0.97);
      const { p, tan } = polyAt(parent.pts, t);
      const nn = new V().crossVectors(Math.abs(tan.y) > 0.9 ? X_AXIS : UP, tan).normalize();
      const bb = new V().crossVectors(tan, nn);
      const phi = phi0 + i * 2.399 + R(-0.3, 0.3);
      const alpha = R(angRange[0], angRange[1]);
      const dir = new V()
        .copy(tan)
        .multiplyScalar(Math.cos(alpha))
        .addScaledVector(nn, Math.cos(phi) * Math.sin(alpha))
        .addScaledVector(bb, Math.sin(phi) * Math.sin(alpha));
      // keep children spreading outward / sideways, not into the crown centre
      const rl = Math.hypot(p.x, p.z) || 1;
      const rx = p.x / rl;
      const rz = p.z / rl;
      const dotR = dir.x * rx + dir.z * rz;
      if (dotR < -0.15) {
        dir.x -= 2 * dotR * rx;
        dir.z -= 2 * dotR * rz;
      }
      if (level === 2) {
        dir.y = dir.y * 0.7 + 0.1;
        dir.x += rx * 0.25;
        dir.z += rz * 0.25;
      }
      if (dir.y < -0.35) dir.y = -0.35 + rnd() * 0.2;
      const len = R(lenRange[0], lenRange[1]) * (1 - 0.3 * t);
      const pts = growPath(p, dir, len, Math.max(2, Math.round(L.segs * (q > 0.6 ? 1 : 0.8))), L.trop, rnd, 2.6);
      const rP = lerp(parent.r0, parent.r1, Math.pow(t, 0.85));
      const r0 = Math.min(rP * R(0.5, 0.68), L.rmax);
      const kid = addBranch(pts, r0, Math.max(0.0035, r0 * 0.22), level, Math.max(3, Math.round(L.sides * (q > 0.6 ? 1 : 0.8))), rP);
      kid.parent = parent;
      kids.push(kid);
    }
    return kids;
  };

  const k2 = [];
  for (const limb of limbs) {
    const isLeader = limb === limbs[limbs.length - 1];
    const n2 = Math.max(2, Math.round((isLeader ? R(3, 4) : R(5, 7)) * (q > 0.6 ? 1 : 0.75)));
    k2.push(...spawn(limb, n2, 2, isLeader ? 0.3 : 0.14, 0.95, isLeader ? [1.4, 2.2] : [2.0, 3.2], [0.7, 1.2]));
  }
  const k3 = [];
  for (const b of k2) {
    const n3 = Math.max(1, Math.round(R(2, 3.2) * (q > 0.6 ? 1 : 0.7)));
    k3.push(...spawn(b, n3, 3, 0.3, 0.95, [1.0, 1.7], [0.6, 1.15]));
  }
  if (q > 0.5) {
    const density = q > 0.8 ? 1 : 0.6;
    for (const b of k3) {
      const n4 = Math.max(1, Math.round(R(1.4, 2.6) * density));
      spawn(b, n4, 4, 0.25, 0.95, [0.45, 0.95], [0.55, 1.0]);
    }
  }

  // ---- crown volume (from the fine branches) ----
  let sx = 0;
  let sz = 0;
  let sy = 0;
  let cnt = 0;
  let maxY = 0;
  const hr = [];
  for (const b of branches) {
    if (b.level < 2) continue;
    for (const p of b.pts) {
      sx += p.x;
      sz += p.z;
      sy += p.y;
      cnt++;
      if (p.y > maxY) maxY = p.y;
    }
  }
  const cx = sx / cnt;
  const cz = sz / cnt;
  for (const b of branches) if (b.level >= 2) for (const p of b.pts) hr.push(Math.hypot(p.x - cx, p.z - cz));
  hr.sort((a, b) => a - b);
  const crown = {
    cx,
    cz,
    cy: sy / cnt - 0.1,
    rx: Math.max(3, hr[Math.floor(hr.length * 0.96)] + 0.3),
    ry: Math.max(2.4, (maxY - sy / cnt) * 1.05 + 0.5),
  };
  const rhoAt = (x, y, z) => {
    const dx = (x - crown.cx) / crown.rx;
    const dy = (y - crown.cy) / crown.ry;
    const dz = (z - crown.cz) / crown.rx;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };

  // ---- prune bare twigs: a twig that would end in a gap of the blossom field (or far
  //      outside the crown) would show as a lone dark hairline against the sky ----
  const fieldAt = (x, y, z) => nz3(x * 0.75, y * 0.75, z * 0.75);
  const tipOK = (b) => {
    const p = b.pts[b.pts.length - 1];
    return fieldAt(p.x, p.y, p.z) >= 0.36 && rhoAt(p.x, p.y, p.z) < 1.12;
  };
  for (const b of branches) b.live = 0;
  for (const lvl of [4, 3]) {
    for (const b of branches) {
      if (b.level !== lvl) continue;
      if (b.live === 0 && !tipOK(b)) b.pruned = true;
      else if (b.parent) b.parent.live++;
    }
  }
  const alive = branches.filter((b) => !b.pruned);

  // ---- bark mesh ----
  const mb = new MeshBuilder();
  const colorFor = (level, baseCol, rP) => (x, y, z, nx, ny, nz, t, dist) => {
    const v = 1 + (nz3(x * 2.4, y * 2.4, z * 2.4) - 0.5) * 0.5;
    let ao = 1;
    if (level >= 1 && y > 2.2) ao *= lerp(0.72, 1, smooth(0.3, 0.95, rhoAt(x, y, z)));
    ao *= 0.8 + 0.2 * (ny * 0.5 + 0.5);
    // dark crotch where a branch leaves its parent
    if (level >= 1 && rP) ao *= lerp(0.66, 1, smooth(0, 2.4 * rP + 0.03, dist));
    // trunk foot sinks into the ground
    if (y < 0.5) ao *= lerp(0.6, 1, clamp(y / 0.5, 0, 1));
    let r = baseCol.r * v * ao;
    let g = baseCol.g * v * ao;
    let b = baseCol.b * v * ao;
    if (y < 0.9) {
      const m = (1 - y / 0.9) * 0.55 * smooth(0.35, 0.7, nz3(x * 3, 2, z * 3));
      r = lerp(r, MOSS.r * ao, m);
      g = lerp(g, MOSS.g * ao, m);
      b = lerp(b, MOSS.b * ao, m);
    }
    return [r, g, b];
  };
  const repFor = (rAvg) => Math.max(1, Math.round((TAU * rAvg) / 0.5));

  // trunk
  const trunkRep = repFor(rBase * 0.8);
  addTube(mb, trunkPts, trunkR, trunkSides, {
    repU: trunkRep,
    vLen: (TAU * rBase * 0.8) / trunkRep,
    cap: 2,
    radiusMod: (i, d) => {
      const h = Math.max(0, trunkH[Math.min(i, trunkH.length - 1)]);
      const az = Math.atan2(d.z, d.x);
      let lobe = 0;
      for (const la of lobeAz) lobe += Math.pow(Math.max(0, Math.cos(az - la)), 4);
      return 1 + 0.36 * Math.min(1, lobe) * Math.exp(-h / 0.55) + 0.035 * Math.sin(az * 3 + h * 4);
    },
    color: colorFor(0, BARK_TRUNK),
  });
  // surface roots: a few long ones that sink into the ground
  const nRoot = nb + 1;
  const rootA0 = R(0, TAU);
  for (let k = 0; k < nRoot; k++) {
    const az = k < nb ? lobeAz[k] + R(-0.15, 0.15) : rootA0;
    const L = R(0.85, 1.9);
    const pts = [];
    const rr = [];
    const seg = 5;
    for (let i = 0; i <= seg; i++) {
      const s = i / seg;
      const rad = rBase * 0.75 + L * s;
      const a = az + Math.sin(s * 3 + k) * 0.14;
      pts.push(new V(Math.cos(a) * rad, 0.3 * Math.pow(1 - s, 1.6) - 0.02 - 0.12 * s, Math.sin(a) * rad));
      rr.push(lerp(R(0.09, 0.125), 0.024, Math.pow(s, 0.8)));
    }
    addTube(mb, pts, rr, q > 0.6 ? 6 : 5, { repU: 1, vLen: 0.4, color: colorFor(0, BARK_TRUNK) });
  }
  // branches
  for (const b of alive) {
    const n = b.pts.length;
    const radii = [];
    for (let i = 0; i < n; i++) radii.push(lerp(b.r0, b.r1, Math.pow(i / (n - 1), 0.85)));
    const rep = repFor((b.r0 + b.r1) * 0.5);
    const base = b.level <= 2 ? BARK_LIMB : BARK_TWIG;
    addTube(mb, b.pts, radii, b.sides, {
      repU: rep,
      vLen: (TAU * (b.r0 + b.r1) * 0.5) / rep + 0.02,
      cap: b.level <= 2 ? 2 : 1,
      collar: { k: b.level <= 1 ? 0.42 : 0.55, len: (b.rP || 0.15) * 1.1 + 0.03 },
      color: colorFor(b.level, base, b.rP),
    });
  }
  const bark = mb.build();

  // ---- blossoms ----
  const N = Math.max(200, Math.round(MAX_SPRITES * Math.pow(q, 1.05)));
  const sizeScale = Math.pow(1 / q, SIZE_EXP);
  const hosts = alive.filter((b) => b.level >= 1);
  let total = 0;
  for (const h of hosts) total += h.len * h.w;
  const sprites = [];
  const sizeFor = (rho0, small) =>
    (small ? R(0.5, 0.95) : rnd() < 0.5 ? R(0.7, 1.1) : R(1.1, 1.65)) * lerp(1, 0.64, smooth(0.7, 1.05, rho0)) * sizeScale;

  // (1) a cluster at the end of every fine twig: twigs never end bare (no dark
  //     slivers floating in the crown); in gaps the clusters are just smaller
  const tips = alive.filter((b) => b.level <= 2 || b.live === 0);
  for (let i = tips.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = tips[i];
    tips[i] = tips[j];
    tips[j] = t;
  }
  const tipCap = Math.floor(N * 0.4);
  const rAxisOK = (px, py, pz) => {
    // keep the trunk, the fork and the first metres of the limbs free of blossom
    const ra = Math.hypot(px - trunkAt(py).x, pz - trunkAt(py).z);
    return !((ra < 1.5 && py < 5.0) || (ra < 2.4 && py < 3.8));
  };
  const tipList = [];
  for (const b of tips) {
    const reps = b.level === 1 ? 3 : 1;
    for (let r = 0; r < reps; r++) tipList.push({ b, back: r * 0.07 });
  }
  for (const { b, back } of tipList) {
    if (sprites.length >= tipCap) break;
    const p = polyAt(b.pts, 1 - back).p;
    let ox = rnd() * 2 - 1;
    let oy = (rnd() * 2 - 1) * 0.8 - 0.1;
    let oz = rnd() * 2 - 1;
    const ol = Math.hypot(ox, oy, oz) || 1;
    ox /= ol;
    oy /= ol;
    oz /= ol;
    const rr = R(0.05, 0.32);
    const px = p.x + ox * rr;
    const py = p.y + oy * rr;
    const pz = p.z + oz * rr;
    if (py < 2.5 || !rAxisOK(px, py, pz)) continue;
    const rho0 = rhoAt(px, py, pz);
    const gapK = lerp(0.72, 1, smooth(0.3, 0.5, fieldAt(px, py, pz)));
    sprites.push({ px, py, pz, ox, oy, oz, size: sizeFor(rho0, true) * gapK, level: b.level });
  }

  // (2) fill along the skeleton, dense toward the tips; a low-frequency density
  //     field leaves clumps and gaps where limbs and sky show through
  let attempts = 0;
  while (sprites.length < N && attempts < N * 8) {
    attempts++;
    let u = rnd() * total;
    let host = hosts[0];
    for (const h of hosts) {
      u -= h.len * h.w;
      if (u <= 0) {
        host = h;
        break;
      }
    }
    const t = lerp(host.t0, 1, Math.pow(rnd(), 0.75));
    const { p } = polyAt(host.pts, t);
    let ox = rnd() * 2 - 1;
    let oy = (rnd() * 2 - 1) * 0.8 - 0.1;
    let oz = rnd() * 2 - 1;
    const ol = Math.hypot(ox, oy, oz) || 1;
    ox /= ol;
    oy /= ol;
    oz /= ol;
    const rr = R(0.1, 0.7);
    const px = p.x + ox * rr;
    const py = p.y + oy * rr;
    const pz = p.z + oz * rr;
    const rho0 = rhoAt(px, py, pz);
    // the outer rim of the umbrella droops lower than the middle of the crown
    if (py < (rho0 > 0.72 ? 2.5 : 2.8) || !rAxisOK(px, py, pz)) continue;
    const fld = fieldAt(px, py, pz);
    if (rnd() > lerp(1, smooth(0.34, 0.54, fld), 0.9)) continue;
    sprites.push({ px, py, pz, ox, oy, oz, size: sizeFor(rho0, false), level: host.level });
  }

  const nS = sprites.length;
  const pos = new Float32Array(nS * 12);
  const nor = new Float32Array(nS * 12);
  const cor = new Float32Array(nS * 8);
  const info = new Float32Array(nS * 16);
  const shade = new Float32Array(nS * 8);
  const idx = new Uint16Array(nS * 6);
  const CORNERS = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  const yMinCrown = 2.5;
  const yMaxCrown = maxY + 0.5;
  for (let i = 0; i < nS; i++) {
    const s = sprites[i];
    const dx = (s.px - crown.cx) / crown.rx;
    const dy = (s.py - crown.cy) / crown.ry;
    const dz = (s.pz - crown.cz) / crown.rx;
    const rho = Math.sqrt(dx * dx + dy * dy + dz * dz);
    // crown-ellipsoid normal, bent by the sprite's own offset from its twig
    let nx = dx / crown.rx;
    let ny = dy / crown.ry;
    let nzv = dz / crown.rx;
    const nl = Math.hypot(nx, ny, nzv) || 1;
    // clump-scale bulges: normal follows the gradient of the density field
    const ge = 0.45;
    const f0 = nz3(s.px * 1.1, s.py * 1.1, s.pz * 1.1);
    let gx = (nz3((s.px + ge) * 1.1, s.py * 1.1, s.pz * 1.1) - nz3((s.px - ge) * 1.1, s.py * 1.1, s.pz * 1.1)) / (2 * ge);
    let gy = (nz3(s.px * 1.1, (s.py + ge) * 1.1, s.pz * 1.1) - nz3(s.px * 1.1, (s.py - ge) * 1.1, s.pz * 1.1)) / (2 * ge);
    let gz = (nz3(s.px * 1.1, s.py * 1.1, (s.pz + ge) * 1.1) - nz3(s.px * 1.1, s.py * 1.1, (s.pz - ge) * 1.1)) / (2 * ge);
    const gl = Math.hypot(gx, gy, gz);
    const gk = gl > 0.9 ? 0.9 / gl : 1;
    gx *= gk * 1.5;
    gy *= gk * 1.5;
    gz *= gk * 1.5;
    nx = (nx / nl) * 0.7 + s.ox * 0.4 + gx + (rnd() - 0.5) * 0.1;
    ny = (ny / nl) * 0.7 + s.oy * 0.4 + gy + (rnd() - 0.5) * 0.1 + 0.08;
    nzv = (nzv / nl) * 0.7 + s.oz * 0.4 + gz + (rnd() - 0.5) * 0.1;
    const nl2 = Math.hypot(nx, ny, nzv) || 1;
    nx /= nl2;
    ny /= nl2;
    nzv /= nl2;
    const height01 = clamp((s.py - yMinCrown) / (yMaxCrown - yMinCrown), 0, 1);
    const inner = smooth(0.3, 0.98, rho);
    const ao = clamp(lerp(0.5, 1, inner) * lerp(0.86, 1, height01) * lerp(0.72, 1, smooth(0.36, 0.58, f0)) * (0.97 + rnd() * 0.06), 0.35, 1);
    const clump = nz3(s.px * 0.95 + 7, s.py * 0.95, s.pz * 0.95 + 3) - 0.5;
    const pinkBias = clamp(-0.02 + clump * 0.42 + (rnd() - 0.5) * 0.06, -0.3, 0.4);
    const sway = clamp(0.25 + rho * 0.8, 0.2, 1.1);
    const roll = rnd() * TAU;
    const tile = Math.floor(rnd() * 4);
    for (let k = 0; k < 4; k++) {
      const vi = i * 4 + k;
      pos[vi * 3] = s.px;
      pos[vi * 3 + 1] = s.py;
      pos[vi * 3 + 2] = s.pz;
      nor[vi * 3] = nx;
      nor[vi * 3 + 1] = ny;
      nor[vi * 3 + 2] = nzv;
      cor[vi * 2] = CORNERS[k][0];
      cor[vi * 2 + 1] = CORNERS[k][1];
      info[vi * 4] = s.size;
      info[vi * 4 + 1] = roll;
      info[vi * 4 + 2] = tile;
      info[vi * 4 + 3] = pinkBias;
      shade[vi * 2] = ao;
      shade[vi * 2 + 1] = sway;
    }
    idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  }
  const blossom = new THREE.BufferGeometry();
  blossom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  blossom.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  blossom.setAttribute("aCorner", new THREE.BufferAttribute(cor, 2));
  blossom.setAttribute("aInfo", new THREE.BufferAttribute(info, 4));
  blossom.setAttribute("aShade", new THREE.BufferAttribute(shade, 2));
  blossom.setIndex(new THREE.BufferAttribute(idx, 1));
  blossom.computeBoundingSphere();
  blossom.boundingSphere.radius += 1.9 * sizeScale;

  // ---- ground decal (soft shadow + fallen petals); dropped on far / low-quality trees ----
  let ground = null;
  if (q >= GROUND_MIN_Q) ground = buildGround(rnd, q, crown, seed);

  return { bark, blossom, ground };
}

function buildGround(rnd, q, crown, seed) {
  const pos = [];
  const uv = [];
  const col = [];
  const idx = [];
  let n = 0;
  const quad = (cx, cz, hx, hz, rot, y, u0, v0, u1, v1, c) => {
    const cr = Math.cos(rot);
    const sr = Math.sin(rot);
    const cs = [
      [-hx, -hz, u0, v0],
      [hx, -hz, u1, v0],
      [hx, hz, u1, v1],
      [-hx, hz, u0, v1],
    ];
    for (const [x, z, u, v] of cs) {
      pos.push(cx + x * cr - z * sr, y, cz + x * sr + z * cr);
      uv.push(u, v);
      col.push(c[0], c[1], c[2]);
    }
    idx.push(n, n + 2, n + 1, n, n + 3, n + 2); // facing up
    n += 4;
  };
  const white = [1, 1, 1];
  const U = (px) => px / DECAL_W;
  const W = (py) => py / DECAL_H;
  // shadows fall away from the sun (world axes; the mesh is counter-rotated by rotationY)
  const H = Math.max(3.4, crown.cy + 0.4);
  const sx = -SUN.x / SUN.y;
  const sz = -SUN.z / SUN.y;
  const shadowRot = Math.atan2(sz, sx);
  const rw = crown.rx * 1.15;
  // dappled crown shadow (elongated along the shadow direction)
  quad(crown.cx + sx * H * 0.85, crown.cz + sz * H * 0.85, rw * 1.08, rw * 0.82, shadowRot, 0.05, U(512), W(256), U(1024), W(512), white);
  // contact shadow under the trunk
  quad(0, 0, 1.35, 1.35, 0, 0.054, U(512), 0, U(768), W(256), white);
  // drift of fallen petals + pink haze, pushed a little downwind
  quad(0.5, -0.35, DECAL_DRIFT_M / 2, DECAL_DRIFT_M / 2, (seed * 2.1) % TAU, 0.058, 0, 0, U(512), 1, white);
  // a few larger single petals for close-up sparkle
  const nP = Math.round(46 * q);
  const pc = [C("#fdeef2"), C("#f8d3de"), C("#f2b9cb"), C("#eaa2bb")];
  for (let i = 0; i < nP; i++) {
    const r = 0.45 + Math.pow(rnd(), 0.8) * (crown.rx * 0.7);
    const a = rnd() * TAU;
    const x = Math.cos(a) * r + 0.5 * rnd();
    const z = Math.sin(a) * r - 0.35 * rnd();
    const c = pc[Math.floor(rnd() * pc.length)];
    const s = 0.017 + rnd() * 0.017;
    quad(x, z, s, s * 0.7, rnd() * TAU, 0.062, U(780), W(12), U(820), W(52), [c.r, c.g, c.b]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

function destroyTree(t) {
  t.bark.dispose();
  t.blossom.dispose();
  if (t.ground) t.ground.dispose();
}

const treeCache = makeCache((key) => {
  const [seed, q] = key.split(":");
  return buildTree(Number(seed), Number(q));
}, destroyTree);

// ---------------------------------------------------------------------------
// component
// ---------------------------------------------------------------------------
export default function SakuraTree({ seed = 1, position = [0, 0, 0], rotationY = 0, scale = 1, quality = 1 }) {
  const qn = Number(quality);
  const q = Math.round(clamp(Number.isFinite(qn) ? qn : 1, 0.35, 1) * 20) / 20;
  const sn = Number(seed);
  const s = Number.isFinite(sn) ? Math.round(sn) : 1;
  const key = `${s}:${q}`;
  const tree = useMemo(() => treeCache.get(key), [key]);
  const shared = useMemo(() => sharedCache.get("shared"), []);

  useEffect(() => {
    treeCache.retain(tree);
    sharedCache.retain(shared);
    return () => {
      treeCache.release(tree);
      sharedCache.release(shared);
    };
  }, [tree, shared]);

  const g = tree.value;
  const m = shared.value;
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={scale}>
      <mesh geometry={g.bark} material={m.bark} dispose={null} />
      <mesh geometry={g.blossom} material={m.blossom} dispose={null} />
      {g.ground && <mesh geometry={g.ground} material={m.ground} rotation={[0, -rotationY, 0]} renderOrder={1} dispose={null} />}
    </group>
  );
}
