// PetalDrift — a light spring breeze of cherry-blossom petals that follows the
// walker down the sando.
//
//   <PetalDrift />                       ~400 sharp petals + 12 close bokeh petals
//   <PetalDrift count={250} bokeh={8} />
//
// Everything is animated in the vertex shader from one time uniform: wind,
// gusts, sway, flutter and a real 3D tumble (petals go edge-on now and then).
// The volume is re-centred on the camera *inside the shader* (mod() wrap in
// camera-relative space, read from the built-in `cameraPosition` uniform, so it
// never lags a frame behind the rig), and petals fade out at every wall of the
// volume, so nothing pops when it wraps. No per-frame CPU work except two
// uniform writes. Two draw calls: the sharp set and the bokeh set.
//
// Props (all optional): count = 400, bokeh = 12, wind = 1 (breeze strength),
// timeOffset = 0 (seconds added to the clock — handy for lab screenshots).
import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mulberry32, range, makeNoise2D } from "./rng.js";
import { WORLD } from "./WorldEnvironment.jsx";

// ---------------------------------------------------------------------------
// Petal textures (built in code — RGBA data textures, no image files)
// ---------------------------------------------------------------------------
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// half width of the petal at v (0 = base, 1 = tip), in u units (u = -1..1 across the texture)
function petalHalfWidth(v) {
  if (v <= 0 || v >= 1) return 0;
  return 1.393 * Math.pow(v, 0.5) * Math.pow(1 - Math.pow(v, 3.4), 0.5);
}

// true when (u, v) lies inside the notched, obovate petal outline
function petalInside(u, v) {
  const au = Math.abs(u);
  if (au >= petalHalfWidth(v)) return false;
  const nw = 0.27;
  if (au < nw) {
    const cut = 1 - 0.075 * Math.pow(1 - au / nw, 1.3);
    if (v > cut) return false;
  }
  return true;
}

const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// RGBA pixels of a sharp petal: #fdf0f3 -> #eea3bc gradient with blush at the
// base, a pink rim, a pink notched tip and faint veins. Colour is written
// everywhere (also outside the outline) so mip-mapping never drags dark
// fringes in.
function buildSharpPetalPixels(size, noise) {
  const pale = [253, 240, 243];
  const rose = [238, 163, 188];
  const out = new Uint8Array(size * size * 4);
  const ss = 3;
  const veinT = [-0.6, -0.32, 0, 0.32, 0.6];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let cov = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = ((x + (sx + 0.5) / ss) / size) * 2 - 1;
          const v = (y + (sy + 0.5) / ss) / size;
          if (petalInside(u, v)) cov++;
        }
      }
      const u = ((x + 0.5) / size) * 2 - 1;
      const v = (y + 0.5) / size;
      const hw = Math.max(0.05, petalHalfWidth(Math.min(0.999, Math.max(0.001, v))));
      const edge = 1 - Math.min(1, Math.abs(u) / hw); // 0 at the rim, 1 at the midrib
      let g = 0;
      g += 0.8 * smooth(0.38, 0.0, v);
      g += 0.5 * smooth(0.3, 0.0, edge);
      g += 0.3 * smooth(0.82, 1.0, v);
      for (let i = 0; i < 5; i++) {
        const d = (u - veinT[i] * Math.pow(v, 0.9)) / 0.028;
        g += (i === 2 ? 0.2 : 0.11) * Math.exp(-d * d) * smooth(0.02, 0.2, v) * smooth(1.0, 0.75, v);
      }
      g += (noise(x * 0.09, y * 0.09) - 0.5) * 0.16;
      g = Math.min(1, Math.max(0, g));
      const c = mixc(pale, rose, g);
      const o = (y * size + x) * 4;
      out[o] = c[0];
      out[o + 1] = c[1];
      out[o + 2] = c[2];
      out[o + 3] = Math.round((cov / (ss * ss)) * 255);
    }
  }
  return out;
}

// RGBA pixels of a soft, out-of-focus petal (heavily blurred silhouette).
function buildBokehPetalPixels(size) {
  const a = new Float32Array(size * size);
  const ss = 3;
  const pad = 0.16; // shrink the outline so the blur never touches the border
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let cov = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = (((x + (sx + 0.5) / ss) / size) * 2 - 1) / (1 - pad * 2);
          const v = ((y + (sy + 0.5) / ss) / size - pad) / (1 - pad * 2);
          if (v > 0 && v < 1 && petalInside(u, v)) cov++;
        }
      }
      a[y * size + x] = cov / (ss * ss);
    }
  }
  const tmp = new Float32Array(size * size);
  const r = Math.round(size * 0.07);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let s = 0;
        for (let k = -r; k <= r; k++) s += a[y * size + Math.min(size - 1, Math.max(0, x + k))];
        tmp[y * size + x] = s / (2 * r + 1);
      }
    }
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let s = 0;
        for (let k = -r; k <= r; k++) s += tmp[Math.min(size - 1, Math.max(0, y + k)) * size + x];
        a[y * size + x] = s / (2 * r + 1);
      }
    }
  }
  let max = 0;
  for (let i = 0; i < a.length; i++) max = Math.max(max, a[i]);
  const pale = [252, 214, 228];
  const rose = [243, 168, 196];
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = mixc(rose, pale, smooth(0.1, 0.7, y / size));
      const o = (y * size + x) * 4;
      out[o] = c[0];
      out[o + 1] = c[1];
      out[o + 2] = c[2];
      out[o + 3] = Math.round(Math.min(1, a[y * size + x] / max) * 255);
    }
  }
  return out;
}

function makePetalTexture(pixels, size) {
  const tex = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
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
// Shaders
// ---------------------------------------------------------------------------
const vertexShader = /* glsl */ `
  attribute vec4 aA; // base position in the unit box (xyz), size in metres (w)
  attribute vec4 aB; // yaw rate, yaw phase, rock amplitude A, rock amplitude B
  attribute vec4 aC; // rock frequency A, phase A, frequency B, phase B
  attribute vec4 aD; // fall speed, wind response, colour mix, cup depth
  attribute vec4 aE; // volume tier, tumbler flag, sway amplitude, gust phase

  uniform float uTime;
  uniform float uViewH;
  uniform float uMinPx;
  uniform float uLock;
  uniform vec3 uWind;

  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vToCam;
  varying float vAlpha;
  varying float vMix;

  #include <fog_pars_vertex>

  mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
  mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
  mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }

  void main() {
    float t = uTime;

    // --- the volume the petal lives in (metres) -------------------------------
    #ifdef BOKEH
      // small box right in front of the lens, relative to the camera
      vec3 bsize = vec3(4.6, 3.2, 3.6);
      vec3 bmin = vec3(-2.3, -1.4, -4.6);
      vec3 camRef = cameraPosition;
    #else
      // sharp petals: a near tier (dense) and a far tier (sparse) ahead of the
      // walker; x / z follow the camera, y is absolute (ground = 0)
      vec3 bsize = mix(vec3(11.0, 6.0, 18.0), vec3(19.0, 9.0, 44.0), aE.x);
      vec3 bmin = mix(vec3(-5.5, 0.0, -15.5), vec3(-9.5, 0.0, -40.0), aE.x);
      vec3 camRef = vec3(cameraPosition.x, 0.0, cameraPosition.z);
    #endif

    // --- drift: wind + gusts, sway, eddies, fall ------------------------------
    vec3 p0 = aA.xyz * bsize;
    float gp = aE.w + 0.11 * p0.x + 0.07 * p0.z; // gust fronts sweep through the volume
    float gust = t - 2.4 * cos(0.27 * t + gp) - 0.36 * cos(0.83 * t + gp * 1.7 + 1.3); // integral of a gusty speed
    vec3 disp = uWind * (aD.y * gust);
    float swayPh = aC.x * t + aC.y;
    disp.xz += vec2(cos(aB.y), sin(aB.y)) * (aE.z * sin(swayPh - 1.5708));
    #ifdef BOKEH
      float eddy = 0.4; // close petals drift slowly and dreamily
    #else
      float eddy = 1.0;
    #endif
    disp.x += eddy * 0.35 * sin(0.37 * t + gp * 1.3);
    disp.z += eddy * 0.30 * cos(0.31 * t + gp);
    disp.y += -aD.x * t + 0.05 * sin(2.0 * swayPh) + 0.28 * sin(0.42 * t + gp);

    // --- wrap into the camera-relative box; fade at every wall ----------------
    vec3 rel = mod(p0 + disp - (1.0 - uLock) * camRef - bmin, bsize) + bmin;
    vec3 nu = (rel - bmin) / bsize;
    #ifdef BOKEH
      float fade = smoothstep(0.0, 0.25, nu.x) * (1.0 - smoothstep(0.75, 1.0, nu.x))
                 * smoothstep(0.0, 0.25, nu.y) * (1.0 - smoothstep(0.75, 1.0, nu.y))
                 * smoothstep(0.0, 0.25, nu.z) * (1.0 - smoothstep(0.75, 1.0, nu.z));
    #else
      float fade = smoothstep(0.0, 0.16, nu.x) * (1.0 - smoothstep(0.84, 1.0, nu.x))
                 * smoothstep(0.0, 0.05, nu.y) * (1.0 - smoothstep(0.86, 1.0, nu.y))
                 * smoothstep(0.0, 0.26, nu.z) * (1.0 - smoothstep(0.90, 1.0, nu.z));
    #endif
    vec3 center = camRef + rel;

    // --- keep far petals from shimmering: a minimum size in pixels ------------
    float dist = length(center - cameraPosition);
    float pxPerM = 0.5 * uViewH * projectionMatrix[1][1] / max(dist, 0.05);
    float boost = max(1.0, uMinPx / max(aA.w * pxPerM, 0.0001));
    float size = aA.w * boost;
    float alpha = fade * pow(1.0 / boost, 1.25);
    #ifdef BOKEH
      alpha *= smoothstep(0.7, 1.7, dist);
    #else
      alpha *= smoothstep(0.9, 2.3, dist);
    #endif

    // --- orientation: heading spin, rocking and (for some) full tumbling -------
    float yaw = aB.y + aB.x * t;
    float rockB = aB.w * sin(aC.z * t + aC.w);
    #ifdef BOKEH
      // out-of-focus petals face the lens and just wobble, like blurred discs
      mat3 toView = mat3(
        vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]),
        vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]),
        vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]));
      float rockA = aB.z * sin(aC.x * t + aC.y);
      mat3 M = toView * rotX(rockA) * rotY(rockB * 0.6) * rotZ(yaw);
    #else
      float bias = 0.8 * sin(aB.y * 2.3 + 1.0); // some petals hang tilted, some flat
      float rockA = aE.y > 0.5 ? aC.x * 1.4 * t + aC.y : bias + aB.z * sin(aC.x * t + aC.y);
      mat3 M = rotY(yaw) * rotX(rockA) * rotZ(rockB) * rotX(-1.5707963);
    #endif

    // --- curved petal surface (cup + curl), local units = petal lengths ------
    float px = position.x * 2.0;
    float py = position.y;
    float cup = aD.w;
    vec3 lp = vec3(position.x * 0.76, py - 0.5, cup * 0.12 * px * px + cup * 0.15 * py * py);
    vec3 nl = normalize(vec3(-cup * 0.24 * px / 0.38, -cup * 0.30 * py, 1.0));

    vec3 wp = center + M * (lp * size);
    vN = M * nl;
    vToCam = cameraPosition - wp;
    vUv = uv;
    vAlpha = alpha;
    vMix = aD.z;

    vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    if (alpha < 0.004) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // fully faded: cull the triangle
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uSunDir;
  uniform vec3 uSunCol;
  uniform vec3 uTint;
  uniform vec3 uDeep;
  uniform float uOpacity;

  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vToCam;
  varying float vAlpha;
  varying float vMix;

  #include <fog_pars_fragment>

  void main() {
    vec4 tex = texture2D(uMap, vUv);
    float a = tex.a * vAlpha * uOpacity;
    #ifdef BOKEH
      a *= mix(0.55, 1.0, vMix);
    #endif
    if (a < 0.01) discard;

    #ifdef BOKEH
      vec3 col = tex.rgb * mix(vec3(1.0), uTint, vMix * 0.6);
    #else
      vec3 V = normalize(vToCam);
      vec3 N = normalize(vN);
      if (dot(N, V) < 0.0) N = -N; // two-sided: always shade the side that faces the eye
      float nl = dot(N, uSunDir);
      float front = clamp(nl, 0.0, 1.0);  // sun on the eye's side of the petal
      float back = clamp(-nl, 0.0, 1.0);  // sun behind the petal: light shines through

      vec3 albedo = tex.rgb * mix(vec3(1.0), uTint, vMix);
      vec3 amb = mix(vec3(0.90, 0.85, 0.80), vec3(1.0, 0.99, 1.0), 0.5 + 0.5 * N.y); // ground bounce / sky
      vec3 col = albedo * amb * (0.84 + 0.16 * front);
      col *= mix(vec3(1.0), uSunCol, front * 0.3);
      // translucency: sun behind a thin petal shines through it — brighter and a
      // little more saturated, without the ground-bounce darkening
      vec3 glow = clamp(pow(albedo, vec3(1.3)) * vec3(1.08, 1.07, 1.09), 0.0, 1.0);
      col = mix(col, glow, smoothstep(0.0, 0.5, back) * 0.85);
      // edge-on petals read as a thin, deeper pink line instead of vanishing into the sky
      float fr = pow(1.0 - abs(dot(N, V)), 4.0);
      col = mix(col, uDeep, fr * 0.45);
    #endif

    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

// ---------------------------------------------------------------------------
// Instances
// ---------------------------------------------------------------------------
const TWO_PI = Math.PI * 2;
const frac = (x) => x - Math.floor(x);

// Sharp petals: ~400, in a near (dense) and a far (sparse) tier.
function fillSharp(n) {
  const next = mulberry32(90210);
  const A = new Float32Array(n * 4);
  const B = new Float32Array(n * 4);
  const C = new Float32Array(n * 4);
  const D = new Float32Array(n * 4);
  const E = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const k = i * 4;
    // R3 low-discrepancy sequence: even coverage of the box, no random clumps
    A[k] = frac(0.5 + (i + 1) * 0.8191725134);
    A[k + 1] = frac(0.5 + (i + 1) * 0.6710436067);
    A[k + 2] = frac(0.5 + (i + 1) * 0.5497004779);
    A[k + 3] = 0.058 + 0.062 * Math.pow(next(), 1.3);

    B[k] = (next() < 0.5 ? -1 : 1) * range(next, 0.35, 1.5);
    B[k + 1] = next() * TWO_PI;
    B[k + 2] = range(next, 0.35, 1.9);
    B[k + 3] = range(next, 0.25, 1.25);

    C[k] = range(next, 1.0, 2.6);
    C[k + 1] = next() * TWO_PI;
    C[k + 2] = range(next, 0.9, 2.4);
    C[k + 3] = next() * TWO_PI;

    D[k] = range(next, 0.22, 0.6);
    D[k + 1] = range(next, 0.65, 1.35);
    D[k + 2] = Math.pow(next(), 1.15);
    D[k + 3] = range(next, 0.6, 1.4);

    E[k] = Math.pow(next(), 2.0); // most petals live in the near tier
    E[k + 1] = next() < 0.22 ? 1 : 0; // tumblers turn all the way over
    E[k + 2] = range(next, 0.12, 0.5);
    E[k + 3] = next() * TWO_PI;
  }
  return { A, B, C, D, E };
}

// Bokeh petals: a few big, slow, soft ones close to the lens.
function fillBokeh(n) {
  const next = mulberry32(31337);
  const A = new Float32Array(n * 4);
  const B = new Float32Array(n * 4);
  const C = new Float32Array(n * 4);
  const D = new Float32Array(n * 4);
  const E = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const k = i * 4;
    A[k] = frac(0.5 + (i + 1) * 0.8191725134);
    A[k + 1] = frac(0.5 + (i + 1) * 0.6710436067);
    A[k + 2] = frac(0.5 + (i + 1) * 0.5497004779);
    A[k + 3] = range(next, 0.14, 0.3);

    B[k] = (next() < 0.5 ? -1 : 1) * range(next, 0.15, 0.5);
    B[k + 1] = next() * TWO_PI;
    B[k + 2] = range(next, 0.3, 1.1);
    B[k + 3] = range(next, 0.2, 0.8);

    C[k] = range(next, 0.5, 1.2);
    C[k + 1] = next() * TWO_PI;
    C[k + 2] = range(next, 0.5, 1.1);
    C[k + 3] = next() * TWO_PI;

    D[k] = range(next, 0.05, 0.14);
    D[k + 1] = range(next, 0.3, 0.6);
    D[k + 2] = next();
    D[k + 3] = range(next, 0.4, 0.9);

    E[k] = 0;
    E[k + 1] = 0;
    E[k + 2] = range(next, 0.1, 0.3);
    E[k + 3] = next() * TWO_PI;
  }
  return { A, B, C, D, E };
}

function buildGeometry(base, attrs, n) {
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute("position", base.attributes.position);
  g.setAttribute("uv", base.attributes.uv);
  for (const key of ["A", "B", "C", "D", "E"]) {
    g.setAttribute("a" + key, new THREE.InstancedBufferAttribute(attrs[key], 4));
  }
  g.instanceCount = n;
  return g;
}

function buildPetals(count, bokehCount) {
  const shared = {
    uTime: { value: 0 },
    uViewH: { value: 720 },
    uWind: { value: new THREE.Vector3(0.6, 0, -0.55) },
    uSunDir: { value: new THREE.Vector3(...WORLD.sunDir).normalize() },
    uSunCol: { value: new THREE.Color(WORLD.sun) },
  };

  // one curved-petal grid (40 triangles): x -0.5..0.5, y 0 (base) .. 1 (tip)
  const base = new THREE.PlaneGeometry(1, 1, 4, 5);
  base.translate(0, 0.5, 0);

  const sharpTex = makePetalTexture(buildSharpPetalPixels(256, makeNoise2D(11)), 256);
  const bokehTex = makePetalTexture(buildBokehPetalPixels(128), 128);

  const makeMaterial = (isBokeh, map) =>
    new THREE.ShaderMaterial({
      defines: isBokeh ? { BOKEH: "" } : {},
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uTime: shared.uTime,
        uViewH: shared.uViewH,
        uWind: isBokeh ? { value: new THREE.Vector3() } : shared.uWind,
        uSunDir: shared.uSunDir,
        uSunCol: shared.uSunCol,
        uMap: { value: map },
        uMinPx: { value: isBokeh ? 0 : 2.6 }, // sharp petals never shrink below ~2.6 css px
        uLock: { value: isBokeh ? 0.7 : 0 }, // bokeh petals mostly travel with the lens
        uOpacity: { value: isBokeh ? 0.5 : 0.95 },
        uTint: { value: new THREE.Color(isBokeh ? "#f3b9cc" : "#fbd6e1") },
        uDeep: { value: new THREE.Color("#e58aa8") },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });

  const sharpMat = makeMaterial(false, sharpTex);
  const bokehMat = makeMaterial(true, bokehTex);

  const sharpGeo = buildGeometry(base, fillSharp(count), count);
  const bokehGeo = buildGeometry(base, fillBokeh(bokehCount), bokehCount);

  const sharp = new THREE.Mesh(sharpGeo, sharpMat);
  const bokeh = new THREE.Mesh(bokehGeo, bokehMat);
  for (const [m, order] of [[sharp, 10], [bokeh, 11]]) {
    m.frustumCulled = false; // positions come from the shader
    m.renderOrder = order; // after the opaque world, bokeh over the sharp set
    m.raycast = () => {};
  }
  sharp.name = "PetalDrift.sharp";
  bokeh.name = "PetalDrift.bokeh";

  const dispose = () => {
    base.dispose();
    sharpGeo.dispose();
    bokehGeo.dispose();
    sharpMat.dispose();
    bokehMat.dispose();
    sharpTex.dispose();
    bokehTex.dispose();
  };
  return { sharp, bokeh, shared, sharpMat, bokehMat, clock: { t: 0 }, dispose };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function PetalDrift({ count = 400, bokeh = 12, wind = 1, timeOffset = 0 }) {
  const built = useMemo(() => buildPetals(count, bokeh), [count, bokeh]);

  useEffect(() => () => built.dispose(), [built]);

  // breeze strength (the bokeh set only feels a fraction of it)
  useEffect(() => {
    built.shared.uWind.value.set(0.6 * wind, 0, -0.55 * wind);
    built.bokehMat.uniforms.uWind.value.set(0.14 * wind, 0, -0.1 * wind);
  }, [built, wind]);

  const timeScale = useMemo(() => {
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0.35 : 1;
    } catch {
      return 1;
    }
  }, []);

  useFrame((state, delta) => {
    built.clock.t += Math.min(delta, 0.1) * timeScale;
    built.shared.uTime.value = built.clock.t + timeOffset;
    built.shared.uViewH.value = state.gl.domElement.height;
    built.sharpMat.uniforms.uMinPx.value = 2.6 * Math.min(state.gl.getPixelRatio(), 3);
  });

  return (
    <group>
      <primitive object={built.sharp} />
      <primitive object={built.bokeh} />
    </group>
  );
}
