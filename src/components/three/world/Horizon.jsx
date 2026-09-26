import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { mulberry32, makeNoise2D, fbm } from "./rng.js";
import { WORLD } from "./WorldEnvironment.jsx";

// Horizon — the far end of the world (z = -139 ... -326).
//
// The path ends at a second, hazy torii and a shrine hall; behind them a wooded
// hill, a five-storey pagoda on a knoll, layers of misty blossom-covered hills
// and, over everything, a Mount-Fuji-like cone.
//
// Four draw calls, no per-frame work:
//   terrain     opaque, analytic hills, zoned (pink groves / green / cedar) with
//               vertex colours + a little procedural mottling in the shader
//   fuji        opaque cone with snow, gullies and a lit / shaded flank
//   structures  opaque torii, shrine hall, pagoda, far pavilion (flat colours)
//   sprites     ONE transparent mesh of soft billboards from a canvas atlas:
//               blossom trees, blossom groves, cedars and drifting mist banks.
//               depthWrite is off and the quads are sorted far -> near at build
//               time (the camera only ever looks down -Z), renderOrder -5 puts
//               the mesh after the opaque scene and before every other
//               transparent object, and the sky dome (renderOrder -10) is drawn
//               before everything, so there is nothing to sort against it.
//
// All materials use `fog:false` and mix towards the sky colour with their own
// aerial perspective measured from the *camera*: far = closer to the sky colour
// (and a touch cooler), low = milkier (valley mist that matches the world's
// exp2 fog near the ground so the seam to the ground plane is invisible).
// Colours are picked directly in sRGB like the rest of the `flat` world.

const clamp = THREE.MathUtils.clamp;
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;
const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const mixC = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const mulC = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

// -----------------------------------------------------------------------------
// Landscape: one analytic height function shared by the terrain mesh and by the
// things that stand on it (trees, pagoda).
// -----------------------------------------------------------------------------

const HN = makeNoise2D(11);
const HN2 = makeNoise2D(23);
const HN3 = makeNoise2D(57);

const FUJI = { x: 70, z: -298, H: 70, R: 130 };
const HALL_Z = -176.5;
const TORII_Z = -150;

// elliptical, smooth-edged hills: centre, radii, height, rotation
const BUMPS = [
  // near layer: foothills and the pagoda knoll
  { x: -72, z: -160, rx: 54, rz: 25, a: 11, rot: 0.15 },
  { x: 82, z: -166, rx: 56, rz: 26, a: 12, rot: -0.15 },
  { x: -50, z: -196, rx: 30, rz: 27, a: 12, rot: 0 },
  // middle layer
  { x: 4, z: -230, rx: 66, rz: 43, a: 30, rot: 0.06 }, // wooded hill behind the shrine
  { x: -30, z: -244, rx: 34, rz: 26, a: 14, rot: 0.3 },
  { x: 42, z: -236, rx: 30, rz: 24, a: 9, rot: -0.2 },
  { x: -140, z: -240, rx: 106, rz: 58, a: 44, rot: -0.1 },
  { x: 98, z: -218, rx: 80, rz: 30, a: 17, rot: 0.12 }, // ridge in front of Fuji
  { x: 218, z: -254, rx: 124, rz: 54, a: 38, rot: 0 },
  // far range: separate summits so the skyline is not one sausage
  { x: -250, z: -300, rx: 118, rz: 52, a: 50, rot: 0.05 },
  { x: -118, z: -306, rx: 90, rz: 46, a: 36, rot: -0.05 },
  { x: -10, z: -312, rx: 76, rz: 40, a: 28, rot: 0 },
  { x: 176, z: -306, rx: 96, rz: 46, a: 40, rot: 0.08 },
  { x: 292, z: -300, rx: 100, rz: 50, a: 48, rot: 0 },
];

function terrainHeight(x, z) {
  let h = 0;
  for (const b of BUMPS) {
    const c = Math.cos(b.rot);
    const s = Math.sin(b.rot);
    const dx = x - b.x;
    const dz = z - b.z;
    const u = (dx * c + dz * s) / b.rx;
    const v = (-dx * s + dz * c) / b.rz;
    const q = u * u + v * v;
    if (q < 1) {
      const t = 1 - q;
      h += b.a * t * t * (3 - 2 * t);
    }
  }
  const n = fbm(HN, x * 0.016 + 3.1, z * 0.016 - 1.7, 3);
  h *= 0.7 + 0.6 * n;
  // rolling, wooded relief on top of the big masses
  h += 6.0 * (fbm(HN, x * 0.038 + 9.0, z * 0.038 + 4.0, 4) - 0.5) * smooth(0.5, 10, h);
  h += 1.6 * (fbm(HN3, x * 0.065 + 2.0, z * 0.065 + 8.0, 2) - 0.5) * smooth(2, 12, h);

  // the shrine stands on a flat forecourt: hills only start behind it
  const dxp = Math.max(Math.abs(x) - 26, 0) / 30;
  const dzp = Math.max(-178 - z, 0) / 40;
  h *= smooth(0, 1, Math.hypot(dxp, dzp));

  // far and side edges taper to nothing
  h *= smooth(-326, -294, z) * (1 - smooth(300, 362, Math.abs(x)));

  // the flat ground stays a hair BELOW the world's ground plane (which runs to
  // z=-190) so the two never fight; hills emerge from under it
  return h - 0.12;
}

// -----------------------------------------------------------------------------
// Zoning shared by the terrain colours and the sprite placement, so the pink
// drifts you see on the slopes are the same places where the blossom trees stand.
// -----------------------------------------------------------------------------

const pinkField = (x, z, y) => smooth(0.4, 0.58, fbm(HN2, x * 0.012 + 7.0, z * 0.012 + 3.0, 3)) * (1 - smooth(16, 36, y));
const cedarField = (x, z, y) => smooth(0.52, 0.7, fbm(HN2, x * 0.02 + 40.0, z * 0.02 + 11.0, 3)) * smooth(5, 18, y);

// -----------------------------------------------------------------------------
// The shaders — aerial perspective + baked lighting (+ procedural detail)
// -----------------------------------------------------------------------------

const HAZE = /* glsl */ `
  uniform vec3 uFog;
  uniform vec3 uSky;
  uniform vec3 uTop;
  uniform float uHazeLen;
  uniform float uHazeMax;
  uniform float uMistH;
  uniform float uMistK;
  uniform float uFogDen;

  float h21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  // colour the distance dissolves into: fog near the ground, sky higher up and
  // far away, cooling a little towards the horizon
  vec3 hazeColor(float d, float y) {
    float toSky = max(smoothstep(0.0, 34.0, y), smoothstep(150.0, 340.0, d));
    vec3 hc = mix(uFog, uSky, toSky);
    float cool = 0.10 * smoothstep(8.0, 60.0, y) * smoothstep(60.0, 220.0, d) + 0.16 * smoothstep(160.0, 330.0, d);
    return mix(hc, uTop, cool);
  }

  float hazeAmount(float d, float depth, float y) {
    float hz = min(1.0 - exp(-pow(d / uHazeLen, 1.5)), uHazeMax);
    float fgv = uFogDen * depth;
    float fg = 1.0 - exp(-fgv * fgv);
    // ground mist gets thicker towards the horizon
    float mh = uMistH * mix(0.5, 1.2, smoothstep(150.0, 300.0, d));
    float mist = (1.0 - smoothstep(1.0, mh, y)) * uMistK;
    return mix(hz, max(hz, fg), mist);
  }
`;

const vert = /* glsl */ `
  attribute vec3 aCol;
  varying vec3 vCol;
  varying vec3 vW;
  varying vec3 vN;
  varying float vDepth;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    vCol = aCol;
    vec4 vp = viewMatrix * wp;
    vDepth = -vp.z;
    gl_Position = projectionMatrix * vp;
  }
`;

const frag = /* glsl */ `
  uniform vec3 uSunDir;
  uniform float uAmb;
  uniform float uSun;
  uniform vec4 uFuji;
  varying vec3 vCol;
  varying vec3 vW;
  varying vec3 vN;
  varying float vDepth;
  ${HAZE}

  float h31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  float vn(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = h21(i);
    float b = h21(i + vec2(1.0, 0.0));
    float c = h21(i + vec2(0.0, 1.0));
    float d = h21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float vn3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = mix(mix(h31(i), h31(i + vec3(1.0, 0.0, 0.0)), f.x), mix(h31(i + vec3(0.0, 1.0, 0.0)), h31(i + vec3(1.0, 1.0, 0.0)), f.x), f.y);
    float b = mix(mix(h31(i + vec3(0.0, 0.0, 1.0)), h31(i + vec3(1.0, 0.0, 1.0)), f.x), mix(h31(i + vec3(0.0, 1.0, 1.0)), h31(i + vec3(1.0, 1.0, 1.0)), f.x), f.y);
    return mix(a, b, f.z);
  }

  float fbm3(vec3 p) {
    const mat3 M = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);
    float a = 0.5;
    float s = 0.0;
    for (int i = 0; i < 3; i++) {
      s += a * vn3(p);
      p = M * p * 2.03 + 17.0;
      a *= 0.5;
    }
    return s / 0.875;
  }

  // Smooth mosaic of tree crowns: jittered cells (8 candidates around the point),
  // every crown has its own colour and a lit top / shaded underside; the colours of
  // neighbouring cells are blended softly so there are no polygon edges.
  vec3 canopy(vec3 p, float pz, float cz, float big) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 sg = vec3(f.x > 0.5 ? 1.0 : -1.0, f.y > 0.5 ? 1.0 : -1.0, f.z > 0.5 ? 1.0 : -1.0);
    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    for (int k = 0; k < 8; k++) {
      vec3 o = vec3(mod(float(k), 2.0), mod(floor(float(k) * 0.5), 2.0), floor(float(k) * 0.25)) * sg;
      vec3 c = i + o;
      float hh = h31(c + 41.0);
      vec3 jit = 0.2 + 0.6 * fract(vec3(hh * 7.13, hh * 31.7, hh * 113.9) + h31(c.zxy + 7.0));
      vec3 r = o + jit - f;
      float dd = dot(r, r);
      float pk = smoothstep(1.0 - pz * 1.15 - 0.04, 1.0 - pz * 1.15 + 0.06, fract(hh * 3.7 + big * 0.35));
      vec3 pinkC = mix(vec3(0.93, 0.72, 0.81), vec3(1.0, 0.94, 0.96), fract(hh * 11.3));
      vec3 greenC = mix(vec3(0.42, 0.56, 0.41), vec3(0.64, 0.75, 0.50), fract(hh * 7.7));
      vec3 col = mix(greenC, pinkC, pk);
      float ce = cz * (1.0 - smoothstep(cz * 0.9, cz * 0.9 + 0.1, fract(hh * 5.1)));
      col = mix(col, vec3(0.24, 0.36, 0.31), clamp(ce, 0.0, 1.0) * 0.9);
      // fragment above the crown centre -> lit, below -> shaded
      float lit = clamp(0.5 - 1.25 * r.y - 0.25 * r.x, 0.0, 1.0);
      col *= 0.76 + 0.36 * lit;
      float w = exp(-dd * 12.0);
      acc += col * w;
      wsum += w;
    }
    return acc / max(wsum, 1e-4);
  }

  void main() {
    vec3 n = normalize(vN);
    #ifdef FLIP_BACK
      if (!gl_FrontFacing) n = -n;
    #endif
    vec3 albedo = vCol;
    float d = distance(vW, cameraPosition);

    #ifdef MODE_TERRAIN
    {
      // vCol = (pink zone, cedar zone, baked relief AO)
      float pinkZ = vCol.r;
      float cedarZ = vCol.g;
      float fw = 1.0 - smoothstep(90.0, 270.0, d);
      float amp = mix(1.0, 0.55, smoothstep(120.0, 300.0, d));
      vec3 q = vec3(vW.x, vW.y * 1.5, vW.z);
      float big = vn3(q * 0.03 + 3.0);
      // organic wobble so the crowns do not sit on a regular lattice
      vec3 qw = q + 2.0 * (vec3(vn3(q * 0.08 + 1.0), vn3(q * 0.08 + 7.0), vn3(q * 0.08 + 13.0)) - 0.5);
      // mean colour of the woods: pink drifts inside green
      float pz = clamp(pinkZ * (0.5 + 1.0 * big), 0.0, 1.0);
      vec3 baseGreen = mix(vec3(0.38, 0.52, 0.38), vec3(0.58, 0.69, 0.46), big);
      vec3 base = mix(baseGreen, vec3(0.89, 0.69, 0.78), pz * 0.85) * 0.92;
      vec3 crowns = canopy(qw * 0.14 + 3.0, pz, cedarZ, big);
      vec3 forest = mix(base, crowns, amp);
      // fine flecks fade away with distance
      forest *= 1.0 + 0.22 * fw * (vn3(qw * 0.85 + 5.0) - 0.5);
      vec3 meadow = mix(vec3(0.68, 0.72, 0.54), vec3(0.62, 0.69, 0.50), big);
      albedo = mix(forest, meadow, 1.0 - smoothstep(0.2, 2.5, vW.y)) * vCol.b;
      // far ridges go blue-grey
      albedo = mix(albedo, vec3(0.46, 0.57, 0.66), 0.5 * smoothstep(240.0, 330.0, d));

      // sando continuing to the shrine, and the gravel forecourt (only visible when
      // the ground plane is not there)
      float zin = 1.0 - smoothstep(-141.0, -139.0, vW.z);
      float zout = smoothstep(-170.0, -168.0, vW.z);
      float pathM = (1.0 - smoothstep(1.6, 1.85, abs(vW.x))) * zin * zout;
      float slab = 0.93 + 0.07 * smoothstep(0.02, 0.09, fract(vW.z / 1.3)) * fw + 0.07 * (1.0 - fw);
      vec3 stone = vec3(0.80, 0.77, 0.71) * slab;
      stone *= 1.0 - 0.10 * smoothstep(1.35, 1.6, abs(vW.x));
      float fcM = (1.0 - smoothstep(12.0, 13.5, abs(vW.x))) * (1.0 - smoothstep(-153.0, -151.0, vW.z)) * zout;
      vec3 gravel = vec3(0.86, 0.83, 0.76) * (0.97 + 0.03 * big);
      albedo = mix(albedo, gravel, fcM);
      albedo = mix(albedo, stone, pathM);
    }
    #endif

    #ifdef MODE_FUJI
    {
      vec2 q = vW.xz - uFuji.xy;
      float ang = atan(q.y, q.x);
      float hn = clamp(vW.y / uFuji.z, 0.0, 1.0);
      float wig = ang;
      float streak = vn(vec2(wig * 6.0 + 2.0, hn * 3.0)) * 0.6 + vn(vec2(wig * 13.0, hn * 7.0 + 3.0)) * 0.4;
      float snowLine = 0.60 + (streak - 0.5) * 0.32 - hn * 0.02;
      float snow = smoothstep(snowLine - 0.02, snowLine + 0.05, hn);
      vec3 body = mix(vec3(0.46, 0.55, 0.65), vec3(0.56, 0.62, 0.74), smoothstep(0.1, 0.6, hn));
      body = mix(vec3(0.52, 0.62, 0.55), body, smoothstep(0.04, 0.26, hn));
      float gully = smoothstep(0.5, 0.9, vn(vec2(wig * 15.0, hn * 4.0 + 9.0)));
      body *= 1.0 - 0.09 * gully;
      // snow gullies run down into the blue
      float sg = smoothstep(0.55, 0.9, vn(vec2(wig * 21.0 + 4.0, hn * 5.0))) * smoothstep(snowLine - 0.12, snowLine, hn) * (1.0 - snow);
      body = mix(body, vec3(0.90, 0.90, 0.95), sg * 0.5);
      albedo = mix(body, vec3(0.99, 0.96, 0.96), snow);
    }
    #endif

    #ifdef MODE_STRUCT
    {
      // gentle vertical dirt / weathering on the walls, nothing else
      albedo *= 0.96 + 0.06 * vn(vW.xz * 0.9 + vW.y * 1.7);
    }
    #endif

    // baked light: warm sun from front-left + cool sky / warm ground bounce
    float ndl = max(dot(n, uSunDir), 0.0);
    float hemi = n.y * 0.5 + 0.5;
    vec3 amb = mix(vec3(0.60, 0.56, 0.55), vec3(0.80, 0.82, 0.88), hemi) * uAmb;
    vec3 lit = amb + vec3(1.0, 0.94, 0.82) * (uSun * ndl);
    vec3 c = min(albedo * lit, vec3(1.0));

    // aerial perspective
    float hz = hazeAmount(d, vDepth, vW.y);
    c = mix(c, hazeColor(d, vW.y), hz);

    // dither: the haze gradients are so soft that 8 bit would band
    c += (h21(gl_FragCoord.xy) - 0.5) / 255.0;
    gl_FragColor = vec4(c, 1.0);
  }
`;

const spriteVert = /* glsl */ `
  attribute vec2 aCorner;
  attribute vec2 aDim;
  attribute vec4 aTint;
  attribute float aMode;
  varying vec2 vUv;
  varying vec4 vTint;
  varying float vMode;
  varying vec3 vW;
  varying float vDepth;
  void main() {
    vec3 toCam = cameraPosition - position;
    vec2 hd = toCam.xz;
    float l = max(length(hd), 1e-3);
    vec3 right = vec3(hd.y, 0.0, -hd.x) / l;
    vec3 wp = position + right * (aCorner.x * aDim.x) + vec3(0.0, 1.0, 0.0) * (aCorner.y * aDim.y);
    vW = wp;
    vUv = uv;
    vTint = aTint;
    vMode = aMode;
    vec4 vp = viewMatrix * vec4(wp, 1.0);
    vDepth = -vp.z;
    gl_Position = projectionMatrix * vp;
  }
`;

const spriteFrag = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform float uAmb;
  varying vec2 vUv;
  varying vec4 vTint;
  varying float vMode;
  varying vec3 vW;
  varying float vDepth;
  ${HAZE}

  void main() {
    vec4 t = texture2D(uAtlas, vUv);
    float a = t.a * vTint.a;
    if (a < 0.004) discard;
    float d = distance(vW, cameraPosition);
    vec3 c;
    if (vMode > 0.5) {
      // mist: nothing but the colour the distance dissolves into
      c = hazeColor(d, max(vW.y, 20.0));
      c = mix(c, vec3(1.0, 0.985, 0.965), 0.25);
    } else {
      vec3 col = clamp(t.rgb / max(t.a, 0.004) * vTint.rgb, 0.0, 1.0);
      float hz = hazeAmount(d, vDepth, vW.y);
      c = mix(col, hazeColor(d, vW.y), hz);
    }
    c += (h21(gl_FragCoord.xy) - 0.5) / 255.0;
    gl_FragColor = vec4(c * a, a);
  }
`;

function baseUniforms(params) {
  return {
    uFog: { value: new THREE.Vector3(...rgb(WORLD.fog)) },
    uSky: { value: new THREE.Vector3(...rgb(WORLD.skyHorizon)) },
    uTop: { value: new THREE.Vector3(...rgb(WORLD.skyTop)) },
    uFogDen: { value: WORLD.fogDensity },
    uHazeLen: { value: params.hazeLen ?? 210 },
    uHazeMax: { value: params.hazeMax ?? 0.93 },
    uMistH: { value: params.mistH ?? 14 },
    uMistK: { value: params.mistK ?? 1 },
  };
}

function makeMaterial(defines, params = {}) {
  const sun = new THREE.Vector3(...WORLD.sunDir).normalize();
  return new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    defines,
    side: THREE.DoubleSide,
    fog: false,
    uniforms: {
      ...baseUniforms(params),
      uSunDir: { value: sun },
      uAmb: { value: params.amb ?? 0.86 },
      uSun: { value: params.sun ?? 0.36 },
      uFuji: { value: new THREE.Vector4(FUJI.x, FUJI.z, FUJI.H, FUJI.R) },
    },
  });
}

function makeSpriteMaterial(atlas, params = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: spriteVert,
    fragmentShader: spriteFrag,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    fog: false,
    uniforms: {
      ...baseUniforms(params),
      uAtlas: { value: atlas },
      uAmb: { value: 1 },
    },
  });
}

// -----------------------------------------------------------------------------
// Geometry helpers (all opaque geometry ends up non-indexed with position /
// normal / aCol so it can be merged).
// -----------------------------------------------------------------------------

function prep(g) {
  if (g.index) g = g.toNonIndexed();
  g.deleteAttribute("uv");
  return g;
}

function paintG(g, fn) {
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const col = fn(p.getX(i), p.getY(i), p.getZ(i), n.getX(i), n.getY(i), n.getZ(i));
    c[i * 3] = col[0];
    c[i * 3 + 1] = col[1];
    c[i * 3 + 2] = col[2];
  }
  g.setAttribute("aCol", new THREE.BufferAttribute(c, 3));
  return g;
}

// colour with a fake ambient occlusion: darker towards y0, full colour at y1
const solid = (col, y0, y1, k) => (x, y) => mulC(col, 1 - k * (1 - clamp((y - y0) / Math.max(1e-4, y1 - y0), 0, 1)));

const boxG = (x0, x1, y0, y1, z0, z1, col, k = 0.14) => {
  const g = prep(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0));
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return paintG(g, solid(col, y0, y1, k));
};

const cylG = (rTop, rBot, y0, y1, x, z, col, segs = 8, k = 0.16, open = true) => {
  const g = prep(new THREE.CylinderGeometry(rTop, rBot, y1 - y0, segs, 1, open));
  g.translate(x, (y0 + y1) / 2, z);
  return paintG(g, solid(col, y0, y1, k));
};

// loft a closed cross-section along rings -> flat-shaded solid with end caps
function loftG(rings, colFn) {
  const pts = [];
  const m = rings[0].length;
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < m; j++) {
      const a = rings[i][j];
      const b = rings[i][(j + 1) % m];
      const c = rings[i + 1][(j + 1) % m];
      const d = rings[i + 1][j];
      pts.push(a, b, c, a, c, d);
    }
  }
  for (const [ring, flip] of [[rings[0], false], [rings[rings.length - 1], true]]) {
    for (let j = 1; j < m - 1; j++) {
      if (flip) pts.push(ring[0], ring[j + 1], ring[j]);
      else pts.push(ring[0], ring[j], ring[j + 1]);
    }
  }
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  g.computeVertexNormals();
  return paintG(g, colFn);
}

// hip roof from four separately smoothed slopes with a concave "sori" curve,
// lifted eave corners, a fascia board and (for halls) a ridge cap
function roofG({ a, b, r0, y0, H, p = 1.5, lift = 0.35, thick = 0.5, nu = 8, nv = 5, ns = 4, roof, face, ridge }) {
  const geos = [];
  const yAt = (s, u) => y0 + H * Math.pow(s, p) + lift * Math.pow(Math.abs(u), 3) * (1 - s) * (1 - s);
  const half = (s) => a + (r0 - a) * s;

  for (const kind of ["f", "b", "l", "r"]) {
    const fb = kind === "f" || kind === "b";
    const cols = (fb ? nu : nv) + 1;
    const rows = ns + 1;
    const pos = [];
    const idx = [];
    const eave = [];
    for (let i = 0; i < rows; i++) {
      const s = i / ns;
      for (let j = 0; j < cols; j++) {
        const u = -1 + (2 * j) / (cols - 1);
        let x;
        let z;
        if (fb) {
          x = u * half(s);
          z = b * (1 - s) * (kind === "f" ? 1 : -1);
        } else {
          z = u * b * (1 - s);
          x = half(s) * (kind === "r" ? 1 : -1);
        }
        const y = yAt(s, u);
        pos.push(x, y, z);
        if (i === 0) eave.push([x, y, z]);
      }
    }
    for (let i = 0; i < rows - 1; i++) {
      for (let j = 0; j < cols - 1; j++) {
        const A = i * cols + j;
        idx.push(A, A + 1, A + cols, A + 1, A + cols + 1, A + cols);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const top = prep(g);
    geos.push(paintG(top, (x, y) => mulC(roof, 0.92 + 0.1 * smooth(y0, y0 + H, y))));

    // fascia board under the eave edge
    const fp = [];
    for (let j = 0; j < eave.length - 1; j++) {
      const [x1, y1, z1] = eave[j];
      const [x2, y2, z2] = eave[j + 1];
      fp.push(new THREE.Vector3(x1, y1, z1), new THREE.Vector3(x2, y2, z2), new THREE.Vector3(x2, y2 - thick, z2));
      fp.push(new THREE.Vector3(x1, y1, z1), new THREE.Vector3(x2, y2 - thick, z2), new THREE.Vector3(x1, y1 - thick, z1));
    }
    const fg = new THREE.BufferGeometry().setFromPoints(fp);
    fg.computeVertexNormals();
    geos.push(paintG(fg, () => face));
  }

  if (r0 > 0.01) {
    geos.push(boxG(-r0 - 0.6, r0 + 0.6, y0 + H - 0.2, y0 + H + 0.55, -0.5, 0.5, ridge, 0));
    for (const s of [-1, 1]) geos.push(boxG(s * (r0 + 0.6) - 0.45, s * (r0 + 0.6) + 0.45, y0 + H - 0.1, y0 + H + 1.1, -0.42, 0.42, ridge, 0));
  }
  return geos;
}

// place a list of geometries: rotate around Y, scale, translate
function place(list, x, y, z, rotY = 0, scale = 1) {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY), new THREE.Vector3(scale, scale, scale));
  return list.map((g) => g.clone().applyMatrix4(m));
}

// -----------------------------------------------------------------------------
// Buildings
// -----------------------------------------------------------------------------

const COL = {
  red: rgb("#b8262a"),
  redDark: rgb("#8e1f22"),
  black: rgb("#2a2622"),
  stone: rgb("#b7b1a4"),
  plaster: rgb("#eee6d6"),
  wood: rgb("#5a3f31"),
  woodDark: rgb("#3f2c24"),
  roof: rgb("#50535a"),
  roofFace: rgb("#3d3a3a"),
  ridge: rgb("#3b3c42"),
  lacquer: rgb("#b3402c"),
  gold: rgb("#9a8558"),
};

function buildTorii() {
  const P = [];
  const half = 1.7;
  for (const s of [-1, 1]) {
    P.push(cylG(0.235, 0.29, 0.5, 4.6, s * half, 0, COL.red, 10, 0.12));
    P.push(cylG(0.3, 0.31, -0.02, 0.52, s * half, 0, COL.black, 10, 0, true));
    P.push(boxG(s * half - 0.5, s * half + 0.5, -0.1, 0.1, -0.5, 0.5, COL.stone, 0.2));
  }
  // nuki (tie beam) and gakuzuka (strut with the name plate)
  P.push(boxG(-2.5, 2.5, 3.3, 3.72, -0.13, 0.13, COL.red, 0.1));
  P.push(boxG(-0.16, 0.16, 3.72, 4.62, -0.13, 0.13, COL.red, 0.1));
  P.push(boxG(-0.4, 0.4, 3.9, 4.45, 0.12, 0.17, COL.woodDark, 0));
  // shimaki (lower cross beam) with slightly cut ends
  P.push(boxG(-2.65, 2.65, 4.58, 4.9, -0.3, 0.3, COL.red, 0.05));
  // kasagi: black, curving up at the ends
  const W = 3.35;
  const lift = 0.5;
  const sec = [
    [-0.47, 0],
    [0.47, 0],
    [0.66, 0.3],
    [0, 0.56],
    [-0.66, 0.3],
  ];
  const N = 12;
  const rings = [];
  for (let i = 0; i <= N; i++) {
    const x = -W + (2 * W * i) / N;
    const u = Math.abs(x) / W;
    const y = 4.9 + lift * Math.pow(u, 2.4);
    const th = Math.atan(((lift * 2.4 * Math.pow(u, 1.4)) / W) * Math.sign(x || 1));
    const c = Math.cos(th);
    const s = Math.sin(th);
    rings.push(sec.map(([z, yy]) => new THREE.Vector3(x - yy * s, y + yy * c, z)));
  }
  P.push(loftG(rings, (x, y, z, nx, ny) => (ny < -0.5 ? mulC(COL.woodDark, 1) : COL.black)));
  return P;
}

function buildHall(simple = false) {
  const P = [];
  P.push(boxG(-9.2, 9.2, 0, 1.05, -6.6, 6.6, COL.stone, 0.4));
  if (!simple) {
    for (let k = 0; k < 6; k++) P.push(boxG(-2.4, 2.4, 0, (1.05 * (k + 1)) / 6, 6.6, 6.6 + 0.55 * (6 - k), COL.stone, 0.3));
  }
  // body: plaster walls, dark timber doors, red lintel
  P.push(boxG(-6.3, 6.3, 1.05, 5.0, -4.6, 3.2, COL.plaster, 0.22));
  P.push(boxG(-6.5, 6.5, 4.45, 5.05, -4.8, 3.4, COL.red, 0));
  if (!simple) {
    // the open, shadowed front of the hall between the red pillars
    P.push(boxG(-6.3, 6.3, 1.05, 4.45, 3.2, 3.36, COL.woodDark, 0.1));
    P.push(boxG(-2.8, 2.8, 1.05, 4.3, 3.36, 3.44, COL.wood, 0.15));
    for (const sx of [-1, 1]) {
      for (const off of [4.0, 5.4]) P.push(boxG(sx * off - 0.55, sx * off + 0.55, 1.6, 3.9, 3.2, 3.32, COL.wood, 0.1));
    }
    // colonnade
    for (let k = 0; k < 8; k++) P.push(cylG(0.2, 0.22, 1.05, 4.95, -7.5 + k * (15 / 7), 4.9, COL.red, 8, 0.14));
    for (const sx of [-1, 1]) {
      for (const z of [1.74, -1.42, -4.6]) P.push(cylG(0.2, 0.22, 1.05, 4.95, sx * 7.5, z, COL.red, 8, 0.14));
    }
    P.push(boxG(-7.7, 7.7, 4.5, 4.98, 4.75, 5.05, COL.red, 0));
    for (const sx of [-1, 1]) P.push(boxG(sx * 7.5 - 0.15, sx * 7.5 + 0.15, 4.5, 4.98, -4.8, 4.9, COL.red, 0));
    // veranda railings
    for (const sx of [-1, 1]) {
      P.push(boxG(sx * 5.9 - 3.1, sx * 5.9 + 3.1, 1.05, 1.75, 6.25, 6.4, COL.red, 0.1));
      P.push(boxG(sx * 8.9 - 0.08, sx * 8.9 + 0.08, 1.05, 1.75, -6.3, 6.3, COL.red, 0.1));
    }
  }
  P.push(
    ...roofG({ a: 10.2, b: 8.0, r0: 4.6, y0: 5.05, H: 4.9, p: 1.6, lift: 0.7, thick: 0.6, nu: simple ? 4 : 8, nv: simple ? 3 : 5, ns: simple ? 3 : 4, roof: COL.roof, face: COL.roofFace, ridge: COL.ridge }).map((g) => g.translate(0, 0, 0.3))
  );
  return P;
}

function buildPagoda() {
  const P = [];
  P.push(boxG(-4.6, 4.6, 0, 1.0, -4.6, 4.6, COL.stone, 0.35));
  let y = 1.0;
  let apex = y;
  for (let k = 0; k < 5; k++) {
    const a = 4.3 - k * 0.56;
    const wh = a - 1.55;
    const wallH = 2.1;
    P.push(boxG(-wh, wh, y, y + wallH, -wh, wh, COL.lacquer, 0.25));
    P.push(boxG(-wh - 0.15, wh + 0.15, y + wallH - 0.4, y + wallH, -wh - 0.15, wh + 0.15, COL.redDark, 0));
    const y0 = y + wallH;
    const H = 1.55;
    P.push(...roofG({ a, b: a, r0: 0, y0, H, p: 1.45, lift: 0.3, thick: 0.42, nu: 2, nv: 2, ns: 3, roof: COL.roof, face: COL.roofFace, ridge: COL.ridge }));
    apex = y0 + H;
    y = y0 + 0.55;
  }
  // spire (sorin)
  P.push(cylG(0.13, 0.2, apex - 0.4, apex + 4.6, 0, 0, COL.gold, 6, 0, true));
  for (let i = 0; i < 4; i++) P.push(cylG(0.5 - i * 0.05, 0.5 - i * 0.05, apex + 0.6 + i * 0.7, apex + 0.75 + i * 0.7, 0, 0, COL.gold, 8, 0, true));
  return P;
}

// -----------------------------------------------------------------------------
// Sprite atlas: soft blossom trees / groves / cedars / mist, drawn with the 2D
// canvas API, stored PREMULTIPLIED so bilinear + mip filtering never leaves a dark
// halo around the soft edges.
// -----------------------------------------------------------------------------

const CELL = 256;
const CELLS = { blossomA: 0, blossomB: 1, blossomC: 2, cedar: 3, grove: 4, grove2: 5, blossomD: 6, mist: 7 };

const css = (c, a = 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;

function puff(ctx, x, y, r, col, a = 1, hard = 0.6) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, css(col, a));
  g.addColorStop(hard, css(col, a * 0.86));
  g.addColorStop(1, css(col, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

const ramp3 = (deep, mid, light, t) => (t < 0.5 ? mixC(deep, mid, t * 2) : mixC(mid, light, (t - 0.5) * 2));

const BLOSSOM_PAL = { deep: rgb("#bf869f"), mid: rgb("#efb4c7"), light: rgb("#fff1f5") };
const BARK = rgb("#54463f");

// vase / umbrella shaped crown made of many overlapping puffs (optionally with a
// short, thick trunk and forked limbs showing through the gaps underneath)
function drawCrown(ctx, rnd, o = {}) {
  const pal = o.pal || BLOSSOM_PAL;
  const cx = o.cx ?? 128;
  const cy = o.cy ?? 122;
  const rx = o.rx ?? 110;
  const ry = o.ry ?? 68;
  const n = o.n ?? 320;
  const phi = rnd() * 6.28;
  const psi = rnd() * 6.28;
  const edge = (a) => 1 + 0.09 * Math.sin(3 * a + phi) + 0.06 * Math.sin(5 * a + psi) + 0.035 * Math.sin(9 * a + phi * 2);
  const shape = (px, py) => {
    // flatter underside, skirts that droop at the sides
    let y = py > 0 ? py * 0.7 : py;
    y += 0.2 * px * px - 0.06;
    return y;
  };
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = Math.sqrt(rnd());
    const e = edge(a);
    const px = Math.cos(a) * rr * e;
    const py = shape(px, Math.sin(a) * rr * e);
    pts.push({ px, py, rr, r: (7 + rnd() * 16) * (1.2 - 0.45 * rr), k: rnd() });
  }
  pts.sort((p, q) => q.py - p.py); // paint from the bottom up: lit tops overlap the shaded flanks
  // shaded understorey
  for (let i = 0; i < 40; i++) {
    const px = (rnd() * 2 - 1) * 0.9;
    const py = shape(px, 0.15 + rnd() * 0.4);
    puff(ctx, cx + px * rx, cy + py * ry, 18 + rnd() * 18, pal.deep, 0.9);
  }
  for (const p of pts) {
    const x = cx + p.px * rx;
    const y = cy + p.py * ry;
    const lit = clamp(0.56 - 0.62 * p.py - 0.2 * p.px + (p.k - 0.5) * 0.42, 0, 1);
    const col = ramp3(pal.deep, pal.mid, pal.light, lit);
    // a little cast shadow below each clump, then the lit clump
    if (p.r > 12) puff(ctx, x + 1.5, y + p.r * 0.32, p.r * 0.95, mixC(pal.deep, pal.mid, 0.3), 0.5);
    puff(ctx, x, y, p.r, col, 0.9 + 0.1 * p.k);
  }
  // flower-cluster scale: many small lit / shaded knots
  for (let i = 0; i < 300; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = Math.sqrt(rnd()) * 0.97;
    const px = Math.cos(a) * rr * edge(a);
    const py = shape(px, Math.sin(a) * rr * edge(a));
    const lit = clamp(0.5 - 0.6 * py - 0.2 * px + (rnd() - 0.5) * 0.7, 0, 1);
    const big = rnd() < 0.4;
    puff(ctx, cx + px * rx, cy + py * ry, big ? 4 + rnd() * 3.5 : 2 + rnd() * 2.5, lit > 0.55 ? pal.light : mixC(pal.deep, pal.mid, 0.4 + rnd() * 0.3), 0.85, 0.75);
  }
  if (o.trunk === false) return;
  // trunk and limbs go BEHIND the crown (each new stroke lands behind the previous)
  ctx.globalCompositeOperation = "destination-over";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = css(BARK, 0.95);
  ctx.fillStyle = css(BARK, 0.95);
  const lean = (rnd() - 0.5) * 14;
  const baseY = 251;
  const forkY = cy + ry * 0.62;
  const limb = (x0, y0, x1, y1, x2, y2, w) => {
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(x1, y1, x2, y2);
    ctx.stroke();
  };
  for (const s of [-1, 1]) limb(cx + lean * 0.3, forkY + 2, cx + s * rx * 0.16, forkY - 6, cx + s * rx * 0.36, cy + ry * 0.3, 5);
  limb(cx + lean, baseY, cx + lean * 0.3, baseY - 52, cx + lean * 0.3, forkY + 4, 13);
  ctx.beginPath();
  ctx.moveTo(cx + lean - 17, baseY + 4);
  ctx.quadraticCurveTo(cx + lean - 5, baseY - 20, cx + lean - 7, baseY - 40);
  ctx.lineTo(cx + lean + 7, baseY - 40);
  ctx.quadraticCurveTo(cx + lean + 5, baseY - 20, cx + lean + 17, baseY + 4);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
}

// tall dark cedar (sugi); drawn in a 128 x 256 space, squeezed into the square cell
function drawCedar(ctx, rnd) {
  ctx.save();
  ctx.scale(2, 1);
  const cx = 64;
  const dark = rgb("#2a3f38");
  const mid = rgb("#3b5347");
  const light = rgb("#63796a");
  // ragged, spire-topped column: tiers of drooping tips, thinner at the top
  for (let i = 0; i < 380; i++) {
    const t = Math.pow(rnd(), 0.9);
    const y = 10 + t * 220;
    const w = 3 + 21 * Math.pow(t, 0.75) + Math.sin(t * 23 + 2) * 2.5;
    const u = (rnd() * 2 - 1) * (0.3 + 0.7 * Math.sqrt(rnd()));
    const x = cx + u * w;
    const lit = clamp(0.48 - u * 0.45 + (rnd() - 0.5) * 0.55 - t * 0.1, 0, 1);
    puff(ctx, x, y, 2.6 + rnd() * 5.2 * (0.45 + t), ramp3(dark, mid, light, lit), 0.95, 0.5);
  }
  ctx.lineCap = "round";
  for (let i = 0; i < 90; i++) {
    const t = 0.08 + rnd() * 0.88;
    const y = 10 + t * 220;
    const w = 3 + 21 * Math.pow(t, 0.75);
    const s = rnd() < 0.5 ? -1 : 1;
    ctx.strokeStyle = css(mixC(dark, mid, rnd()), 0.9);
    ctx.lineWidth = 1.9;
    ctx.beginPath();
    ctx.moveTo(cx + s * w * 0.7, y);
    ctx.lineTo(cx + s * (w * 0.92 + 1.5 + rnd() * 3.5), y + 4 + rnd() * 6);
    ctx.stroke();
  }
  ctx.fillStyle = css(rgb("#5b463c"), 1);
  ctx.fillRect(cx - 2.4, 224, 4.8, 28);
  ctx.restore();
}

// blossom / leaf grove: crown-only mound, its flat bottom fades into the slope
function drawGrove(ctx, rnd, o = {}) {
  drawCrown(ctx, rnd, { cy: 134, rx: 112, ry: 70, n: 360, trunk: false, pal: o.pal });
  ctx.globalCompositeOperation = "destination-in";
  const g = ctx.createLinearGradient(0, 150, 0, 216);
  g.addColorStop(0, "rgba(0,0,0,1)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CELL, CELL);
  ctx.globalCompositeOperation = "source-over";
}

// mist bank: a low, wide cloud with feathered edges on all four sides
function drawMist(ctx, rnd) {
  const soft = [0.83, 0.82, 0.86];
  for (let i = 0; i < 80; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = Math.sqrt(rnd());
    const x = 128 + Math.cos(a) * rr * 74;
    const y = 138 + Math.sin(a) * rr * 30;
    puff(ctx, x, y, 18 + rnd() * 30, soft, 0.1 + rnd() * 0.1, 0.3);
  }
  ctx.globalCompositeOperation = "destination-in";
  const g = ctx.createLinearGradient(0, 60, 0, 226);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(0.42, "rgba(0,0,0,1)");
  g.addColorStop(0.68, "rgba(0,0,0,1)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CELL, CELL);
  const h = ctx.createLinearGradient(0, 0, CELL, 0);
  h.addColorStop(0, "rgba(0,0,0,0)");
  h.addColorStop(0.16, "rgba(0,0,0,1)");
  h.addColorStop(0.84, "rgba(0,0,0,1)");
  h.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = h;
  ctx.fillRect(0, 0, CELL, CELL);
  ctx.globalCompositeOperation = "source-over";
}

function makeAtlas() {
  const COLS = 4;
  const ROWS = 2;
  const W = CELL * COLS;
  const H = CELL * ROWS;
  const big = document.createElement("canvas");
  big.width = W;
  big.height = H;
  const bg = big.getContext("2d", { willReadFrequently: true });
  const cell = document.createElement("canvas");
  cell.width = CELL;
  cell.height = CELL;
  const c = cell.getContext("2d");
  const draws = [
    (r) => drawCrown(c, r, {}),
    (r) => drawCrown(c, r, { rx: 102, ry: 76, cy: 118, n: 320 }),
    (r) => drawCrown(c, r, { rx: 116, ry: 60, cy: 128, n: 300 }),
    (r) => drawCedar(c, r),
    (r) => drawGrove(c, r),
    (r) => drawGrove(c, r),
    (r) => drawCrown(c, r, { rx: 96, ry: 80, cy: 112, n: 320 }),
    (r) => drawMist(c, r),
  ];
  draws.forEach((draw, i) => {
    c.clearRect(0, 0, CELL, CELL);
    c.globalCompositeOperation = "source-over";
    draw(mulberry32(4711 + i * 101));
    bg.drawImage(cell, (i % COLS) * CELL, Math.floor(i / COLS) * CELL);
  });
  const src = bg.getImageData(0, 0, W, H).data;
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const sy = H - 1 - y; // DataTexture row 0 is the bottom
    for (let x = 0; x < W; x++) {
      const si = (sy * W + x) * 4;
      const di = (y * W + x) * 4;
      const a = src[si + 3];
      const k = a / 255;
      out[di] = Math.round(src[si] * k);
      out[di + 1] = Math.round(src[si + 1] * k);
      out[di + 2] = Math.round(src[si + 2] * k);
      out[di + 3] = a;
    }
  }
  const tex = new THREE.DataTexture(out, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}


const cellUV = (i) => {
  const col = i % 4;
  const row = Math.floor(i / 4);
  const e = 0.5 / 1024;
  return { u0: col / 4 + e, u1: (col + 1) / 4 - e, vb: 1 - (row + 1) / 2 + e, vt: 1 - row / 2 - e };
};

// -----------------------------------------------------------------------------
// Sprite placement
// -----------------------------------------------------------------------------

function buildSprites() {
  const rnd = mulberry32(90210);
  const Q = [];
  const ground = (x, z) => Math.max(0, terrainHeight(x, z));
  // (w, h) is the size of the whole 256 x 256 cell; the art has an 8 px gutter
  const add = (cell, x, z, w, h, o = {}) => {
    const y = (o.y ?? ground(x, z)) - h * (8 / 256) - (o.sink ?? 0.25);
    Q.push({ cell, x, y, z, w, h, tint: o.tint ?? [1, 1, 1], a: o.a ?? 1, mode: o.mode ?? 0, flip: rnd() < 0.5 });
  };
  const pinkTint = () => {
    const v = 0.95 + rnd() * 0.1;
    return [v * (1 + (rnd() - 0.5) * 0.04), v * (1 + (rnd() - 0.5) * 0.05), v * (1 + (rnd() - 0.5) * 0.04)];
  };
  const blossoms = [CELLS.blossomA, CELLS.blossomB, CELLS.blossomC, CELLS.blossomD];
  const pickB = () => blossoms[Math.floor(rnd() * blossoms.length)];
  const inKnoll = (x, z, r) => Math.hypot(x + 50, z + 196) < r; // the pagoda's knoll top stays clear

  // 1) the end of the avenue: trees flank the second torii and the forecourt
  //    (kept clear of the gate itself so it stays visible between them)
  for (const side of [-1, 1]) {
    for (const [z, x0, w0] of [
      [-136, 9.4, 10.5],
      [-145, 11.8, 11.2],
      [-157, 15.5, 12.4],
      [-169, 20, 13],
      [-182, 25.5, 14],
    ]) {
      const w = w0 * (0.94 + rnd() * 0.12);
      add(pickB(), side * (x0 + (rnd() - 0.5) * 1.4), z + (rnd() - 0.5) * 2, w, w, { tint: pinkTint() });
    }
  }
  // fill-in crowns behind the flanking trees
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const z = -150 - i * 11 - rnd() * 6;
      const x = side * (24 + rnd() * 20);
      const w = 12 + rnd() * 4;
      add(pickB(), x, z, w, w, { tint: pinkTint() });
    }
  }

  // 2) single blossom trees on the near slopes (trunks still readable), following
  //    the pink zoning of the terrain
  let tries = 0;
  let near = 0;
  while (near < 52 && tries++ < 6000) {
    const x = (rnd() * 2 - 1) * 200;
    const z = -142 - rnd() * 92;
    const y = terrainHeight(x, z);
    if (y < 1.0 || Math.abs(x) < 24 || inKnoll(x, z, 12)) continue;
    if (rnd() > pinkField(x, z, y) * 1.3 + 0.06) continue;
    const w = lerp(9.5, 15, smooth(150, 240, -z)) * (0.85 + rnd() * 0.4);
    add(pickB(), x, z, w, w, { y: y - 0.2, tint: pinkTint(), a: 0.96 });
    near++;
  }

  // 3) groves of blossom on the mid / far slopes: many small mounds, denser where
  //    the terrain is pink, thinner elsewhere so the green shows through
  tries = 0;
  let groves = 0;
  while (groves < 330 && tries++ < 20000) {
    const x = (rnd() * 2 - 1) * 335;
    const z = -160 - rnd() * 166;
    const y = terrainHeight(x, z);
    if (y < 1.4 || inKnoll(x, z, 14)) continue;
    if (rnd() > pinkField(x, z, y) * 1.25) continue;
    const dz = -z;
    const w = lerp(8.5, 21, smooth(160, 320, dz)) * (0.75 + rnd() * 0.55);
    add(rnd() < 0.5 ? CELLS.grove : CELLS.grove2, x, z, w, w * 0.74, { y: y - 0.4, tint: pinkTint(), a: 0.94 });
    groves++;
  }

  // 4) cedars: on the higher slopes, in small stands, and behind the shrine
  tries = 0;
  let cedars = 0;
  while (cedars < 60 && tries++ < 9000) {
    let x;
    let z;
    if (cedars < 14) {
      // the wooded hill behind the hall and the pagoda knoll
      x = (rnd() - 0.5) * 78;
      z = -198 - rnd() * 52;
    } else {
      x = (rnd() * 2 - 1) * 320;
      z = -160 - rnd() * 160;
    }
    const y = terrainHeight(x, z);
    if (y < 6 || inKnoll(x, z, 7)) continue;
    if (cedars >= 14 && rnd() > cedarField(x, z, y) * 1.5) continue;
    const dz = -z;
    const h = lerp(7, 15, smooth(150, 320, dz)) * (0.8 + rnd() * 0.5);
    const shade = 1.02 + rnd() * 0.16;
    const k = 2 + Math.floor(rnd() * 4); // irregular stands of 2-5
    for (let j = 0; j < k; j++) {
      const xx = x + (rnd() - 0.5) * h * 1.1;
      const zz = z + (rnd() - 0.5) * h * 0.7;
      const hh = h * (0.55 + rnd() * 0.8);
      add(CELLS.cedar, xx, zz, hh * (0.44 + rnd() * 0.14), hh, { tint: [shade, shade, shade * 1.02], y: terrainHeight(xx, zz) });
      cedars++;
    }
  }

  // 5) mist banks between the layers (they live in the same sorted list)
  const mist = [
    [-60, -188, 210, 9, 0.55],
    [70, -190, 210, 9, 0.55],
    [-34, -168, 110, 12, 0.5],
    [44, -174, 120, 11, 0.42],
    [-124, -208, 150, 18, 0.55],
    [10, -206, 130, 15, 0.5],
    [118, -214, 150, 16, 0.55],
    [-64, -252, 190, 22, 0.5],
    [92, -264, 170, 18, 0.55],
    [-196, -274, 200, 22, 0.5],
    [232, -272, 190, 22, 0.5],
    [24, -288, 200, 20, 0.55],
    [70, -278, 150, 15, 0.5],
  ];
  for (const [x, z, w, h, a] of mist) add(CELLS.mist, x, z, w, h * 1.5, { mode: 1, a, y: -h * 0.12, sink: 0 });

  // far -> near: the camera only ever looks down -Z, so z-order == depth order
  Q.sort((p, q) => p.z - q.z);

  const n = Q.length;
  const pos = new Float32Array(n * 12);
  const corner = new Float32Array(n * 8);
  const dim = new Float32Array(n * 8);
  const uv = new Float32Array(n * 8);
  const tint = new Float32Array(n * 16);
  const mode = new Float32Array(n * 4);
  const index = new Uint32Array(n * 6);
  const corners = [
    [-1, 0],
    [1, 0],
    [1, 1],
    [-1, 1],
  ];
  Q.forEach((q, i) => {
    const t = cellUV(q.cell);
    corners.forEach(([cx, cy], k) => {
      const v = i * 4 + k;
      pos.set([q.x, q.y, q.z], v * 3);
      corner.set([cx, cy], v * 2);
      dim.set([q.w / 2, q.h], v * 2);
      const left = q.flip ? cx > 0 : cx < 0; // mirrored sprites: same art, other way round
      uv.set([left ? t.u0 : t.u1, cy < 0.5 ? t.vb : t.vt], v * 2);
      tint.set([q.tint[0], q.tint[1], q.tint[2], q.a], v * 4);
      mode[v] = q.mode;
    });
    index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aCorner", new THREE.BufferAttribute(corner, 2));
  g.setAttribute("aDim", new THREE.BufferAttribute(dim, 2));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setAttribute("aTint", new THREE.BufferAttribute(tint, 4));
  g.setAttribute("aMode", new THREE.BufferAttribute(mode, 1));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  return g;
}

// -----------------------------------------------------------------------------
// Terrain + Fuji
// -----------------------------------------------------------------------------

function axisSym(max, step0, growFrom, growth) {
  const half = [0];
  let p = 0;
  let s = step0;
  while (p < max) {
    p = Math.min(p + s, max);
    half.push(p);
    if (p > growFrom) s *= growth;
  }
  return [...half.slice(1).reverse().map((v) => -v), ...half];
}

function buildTerrain() {
  const xs = axisSym(364, 4.0, 60, 1.05);
  const zs = [-139];
  let s = 2.5;
  while (zs[zs.length - 1] > -326) {
    zs.push(Math.max(zs[zs.length - 1] - s, -326));
    s = s < 4.5 ? 4.5 : s * 1.06;
  }
  const cols = xs.length;
  const rows = zs.length;
  const pos = new Float32Array(cols * rows * 3);
  const nor = new Float32Array(cols * rows * 3);
  const col = new Float32Array(cols * rows * 3);
  const e = 1.5;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const x = xs[j];
      const z = zs[i];
      const k = (i * cols + j) * 3;
      const y = terrainHeight(x, z);
      pos[k] = x;
      pos[k + 1] = y;
      pos[k + 2] = z;
      const hx = (terrainHeight(x + e, z) - terrainHeight(x - e, z)) / (2 * e);
      const hz = (terrainHeight(x, z + e) - terrainHeight(x, z - e)) / (2 * e);
      const l = Math.hypot(hx, 1, hz);
      nor[k] = -hx / l;
      nor[k + 1] = 1 / l;
      nor[k + 2] = -hz / l;
      // baked relief: gullies darker, spurs lighter
      const cv = y - 0.25 * (terrainHeight(x + 16, z) + terrainHeight(x - 16, z) + terrainHeight(x, z + 16) + terrainHeight(x, z - 16));
      col[k] = pinkField(x, z, y);
      col[k + 1] = cedarField(x, z, y);
      col[k + 2] = clamp(1 + 0.045 * cv, 0.86, 1.1);
    }
  }
  const idx = [];
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const a = i * cols + j;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      if ((i + j) % 2) idx.push(a, c, b, b, c, d);
      else idx.push(a, c, d, a, d, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("aCol", new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

function buildFuji() {
  const { x: cx, z: cz, H, R } = FUJI;
  const K = 16;
  const S = 26;
  const baseR = R * 0.998;
  const rings = [];
  for (let k = 0; k <= K; k++) {
    const r = baseR * Math.pow(k / K, 1.7);
    let y = H * Math.pow(Math.max(0, 1 - r / R), 1.7);
    if (k === 0) y = H * 0.965;
    if (k === 1) y = H * 0.985;
    rings.push({ r, y });
  }
  rings.push({ r: baseR + 2, y: -1.5 });
  const cols = S + 1;
  const pos = [];
  for (const { r, y } of rings) {
    for (let j = 0; j <= S; j++) {
      const th = ((-132 + (234 * j) / S) * Math.PI) / 180;
      const wob = 1 + 0.045 * Math.sin(th * 2.3 + 0.7) + 0.02 * Math.sin(th * 5.1) + 0.012 * Math.sin(th * 11.0 + 1.3);
      pos.push(cx + Math.sin(th) * r * wob, y, cz + Math.cos(th) * r * wob);
    }
  }
  const idx = [];
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < S; j++) {
      const a = i * cols + j;
      idx.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  // analytic normals of the profile (no banding from the coarse rings)
  const p = g.attributes.position;
  const nrm = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const dx = p.getX(i) - cx;
    const dz = p.getZ(i) - cz;
    const r = Math.hypot(dx, dz);
    const t = Math.max(0, 1 - Math.min(r, R * 0.999) / R);
    const slope = (H * 1.7 / R) * Math.pow(t, 0.7); // -dy/dr
    const l = Math.hypot(slope, 1);
    const ux = r > 1e-3 ? dx / r : 0;
    const uz = r > 1e-3 ? dz / r : 0;
    nrm[i * 3] = (ux * slope) / l;
    nrm[i * 3 + 1] = 1 / l;
    nrm[i * 3 + 2] = (uz * slope) / l;
  }
  g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  g.setAttribute("aCol", new THREE.BufferAttribute(new Float32Array(p.count * 3).fill(1), 3));
  return g;
}

function buildStructures() {
  const G = [];
  G.push(...place(buildTorii(), 0, 0.02, TORII_Z, 0, 1.45));
  G.push(...place(buildHall(false), 0, 0.02, HALL_Z, 0, 1.1));
  const py = terrainHeight(-50, -196) - 0.3;
  G.push(...place(buildPagoda(), -50, py, -196, 0.2, 1.0));
  const hy = terrainHeight(124, -236) - 0.3;
  G.push(...place(buildHall(true), 124, hy, -236, -0.15, 0.62));
  return mergeGeometries(G, false);
}

// -----------------------------------------------------------------------------

export default function Horizon() {
  const parts = useMemo(() => {
    const atlas = makeAtlas();
    return {
      atlas,
      terrain: buildTerrain(),
      fuji: buildFuji(),
      sprites: buildSprites(),
      structures: buildStructures(),
      mats: {
        terrain: makeMaterial({ MODE_TERRAIN: "" }, { hazeLen: 245, hazeMax: 0.9, mistH: 9, amb: 0.72, sun: 0.58 }),
        fuji: makeMaterial({ MODE_FUJI: "" }, { hazeLen: 250, hazeMax: 0.88, mistH: 10, amb: 0.82, sun: 0.5 }),
        structures: makeMaterial({ FLIP_BACK: "", MODE_STRUCT: "" }, { hazeLen: 260, mistH: 3, mistK: 0.32, amb: 0.8, sun: 0.5 }),
        sprites: makeSpriteMaterial(atlas, { hazeLen: 245, hazeMax: 0.9, mistH: 9, mistK: 0.9 }),
      },
    };
  }, []);

  useEffect(
    () => () => {
      parts.atlas.dispose();
      parts.terrain.dispose();
      parts.fuji.dispose();
      parts.sprites.dispose();
      parts.structures.dispose();
      Object.values(parts.mats).forEach((m) => m.dispose());
    },
    [parts]
  );

  return (
    <group>
      <mesh geometry={parts.terrain} material={parts.mats.terrain} frustumCulled={false} />
      <mesh geometry={parts.fuji} material={parts.mats.fuji} frustumCulled={false} />
      <mesh geometry={parts.structures} material={parts.mats.structures} frustumCulled={false} />
      <mesh geometry={parts.sprites} material={parts.mats.sprites} renderOrder={-5} frustumCulled={false} />
    </group>
  );
}
