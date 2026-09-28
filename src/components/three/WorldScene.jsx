import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import WorldEnvironment from "./world/WorldEnvironment.jsx";
import ToriiGate from "./world/ToriiGate.jsx";
import Sando, { PATH, LANTERNS, groundHeightAt } from "./world/Sando.jsx";
import SakuraTree from "./world/SakuraTree.jsx";
import Horizon from "./world/Horizon.jsx";
import PetalDrift from "./world/PetalDrift.jsx";
import { mulberry32, range } from "./world/rng.js";

// The whole page is one long walk: the hero looks at the torii gate from the
// front, scrolling carries the camera through it and on down a stone path
// under blooming cherry trees. Content sections slide over the fixed canvas;
// the scenic interludes between them are windows onto it.
//
// World axes: the path runs down -Z, the gate stands at the origin facing +Z.

const TREE_SEEDS = 5;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smoothstep = (edge0, edge1, x) => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------- forest
// Deterministic planting plan — two ranks of trees on each side of the path.
// The inner rank stands close enough to overhang the path and read individual
// blossom clusters; the outer rank is sparser and cheaper and fills the depth.
function plantTrees(lite) {
  const next = mulberry32(2718);
  const trees = [];
  const zEnd = PATH.zEnd + 10;
  const zEndInner = PATH.zEnd + 28; // leave the last stretch open: the shrine at the end shows its roof

  // keep trunks clear of the stone lanterns standing on the same side
  const clearOfLanterns = (side, z) => {
    for (const l of LANTERNS) {
      if (Math.sign(l.x) === side && Math.abs(l.z - z) < 1.7) return l.z - z >= 0 ? z - 2.2 : z + 2.2;
    }
    return z;
  };

  for (const side of [-1, 1]) {
    let z = -8 - (side > 0 ? 3.6 : 0);
    while (z > zEndInner) {
      const zz = clearOfLanterns(side, z + range(next, -1, 1));
      const x = side * range(next, 5.0, 6.6);
      trees.push({
        seed: 1 + Math.floor(next() * TREE_SEEDS),
        position: [x, groundHeightAt(x, zz), zz],
        rotationY: next() * Math.PI * 2,
        scale: range(next, 0.88, 1.18),
        quality: lite ? 0.55 : 1,
      });
      z -= range(next, 6.6, 8.8);
    }
    if (lite) continue;

    z = -2 - (side > 0 ? 6 : 0);
    while (z > zEnd) {
      const x = side * range(next, 11, 17);
      const zz = z + range(next, -2, 2);
      trees.push({
        seed: 1 + Math.floor(next() * TREE_SEEDS),
        position: [x, groundHeightAt(x, zz), zz],
        rotationY: next() * Math.PI * 2,
        scale: range(next, 1, 1.35),
        quality: 0.45,
      });
      z -= range(next, 11, 15);
    }
  }
  return trees;
}

// Only trees in front of the walker (and a little behind) are drawn; the fog
// swallows anything further than ~110 m anyway.
function Forest({ lite, camZRef }) {
  const trees = useMemo(() => plantTrees(lite), [lite]);
  const groups = useRef([]);
  const ahead = lite ? 90 : 100;

  useFrame(() => {
    const camZ = camZRef.current;
    for (let i = 0; i < trees.length; i++) {
      const g = groups.current[i];
      if (!g) continue;
      const dz = camZ - trees[i].position[2];
      const show = dz > -9 && dz < ahead;
      if (g.visible !== show) g.visible = show;
    }
  });

  return (
    <>
      {trees.map((tree, i) => (
        <group key={i} ref={(g) => (groups.current[i] = g)}>
          <SakuraTree {...tree} />
        </group>
      ))}
    </>
  );
}

// ---------------------------------------------------------------- camera
// Hero framing. The gate is the hero, and the page copy is laid over it, so the
// camera is fitted to the real layout: the classic 32° view from 11.5 m on wide
// screens (wider fov on portrait ones), then pitched and, if needed, pulled
// back until the top of the gate sits just below the slogan (topPx, measured
// from the DOM) and its feet stay on screen — and the whole 5.4 m gate fits
// the width. Also returns how far the pillars reach from the screen centre so
// the hero copy can keep clear of them (CSS variable --gate-outer).
const HERO = { y: 1.75, targetY: 2.85, fov: 32, dist: 11.5 };
const WALK = { y: 1.72, lookY: 1.5, fov: 48, look: 30 };
const GATE_PASS_Z = -5.5;
const GATE_TOP = 4.85; // top of the shimaki (m)
const GATE_HALF_SPAN = 2.85; // kasagi half span 2.7 m + a little air
const GATE_HALF_OUTER = 2.3; // pillars + plinths (m)

function heroFraming(width, height, topPx) {
  const aspect = width / Math.max(1, height);
  const t = smoothstep(1.25, 0.5, aspect);
  const fov = THREE.MathUtils.lerp(HERO.fov, 52, t);
  const f = height / 2 / Math.tan(THREE.MathUtils.degToRad(fov) / 2); // focal length in px
  const yTop = THREE.MathUtils.clamp(Number.isFinite(topPx) ? topPx : height * 0.26, height * 0.08, height * 0.5);
  const bottomLimit = height - Math.max(24, height * 0.04);
  const beta = Math.atan((height / 2 - yTop) / f);
  let d = Math.max(HERO.dist, (GATE_HALF_SPAN * f) / (0.48 * width));
  let targetY = HERO.targetY;
  for (let i = 0; i < 80; i++, d += 0.25) {
    const theta = Math.atan((GATE_TOP - HERO.y) / d) - beta;
    targetY = HERO.y + d * Math.tan(theta);
    const yFeet = height / 2 - f * Math.tan(Math.atan(-HERO.y / d) - theta);
    if (yFeet <= bottomLimit) break;
  }
  return {
    fov,
    dist: d,
    targetY,
    walkFov: THREE.MathUtils.lerp(WALK.fov, 62, t),
    gateOuterPx: (GATE_HALF_OUTER / d) * f + 14,
  };
}

// Where (px from the top of the page) the slogan ends: the gate starts below it.
function measureHeroTop() {
  const slogan = document.querySelector(".hero__slogan");
  const hero = document.getElementById("top");
  if (!slogan || !hero) return undefined;
  let y = slogan.offsetHeight;
  for (let el = slogan; el && el !== hero; el = el.offsetParent) y += el.offsetTop;
  return y + 18;
}

// Scroll drives the camera. The first screen of scrolling dollies the camera
// through the gate; the rest of the page is a slow walk down the path.
function CameraRig({ camZRef }) {
  const { camera, size } = useThree();
  const state = useRef({ y: 0, smooth: 0, max: 1, hero: 1, maxSmooth: 1, heroSmooth: 1, framing: null });
  const pointer = useRef(new THREE.Vector2());
  const pointerSmooth = useRef(new THREE.Vector2());
  const tmp = useMemo(() => ({ pos: new THREE.Vector3(), look: new THREE.Vector3() }), []);
  const walkEndZ = PATH.zEnd + 32;

  useEffect(() => {
    const measure = () => {
      const hero = document.getElementById("top");
      state.current.hero = Math.max(1, hero ? hero.offsetHeight : window.innerHeight);
      state.current.max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const framing = heroFraming(window.innerWidth, window.innerHeight, measureHeroTop());
      state.current.framing = framing;
      document.documentElement.style.setProperty("--gate-outer", Math.round(framing.gateOuterPx) + "px");
    };
    const onScroll = () => {
      state.current.y = window.scrollY;
    };
    const onPointer = (e) => {
      pointer.current.set((e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1));
    };
    measure();
    onScroll();
    // The first frames render before fonts/images settle the page height; snap
    // to the real scroll position instead of easing there from the top.
    state.current.smooth = state.current.y;
    state.current.maxSmooth = state.current.max;
    state.current.heroSmooth = state.current.hero;
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", measure);
    window.addEventListener("pointermove", onPointer, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    // the hero copy sets in its web font after the first frames
    document.fonts?.ready.then(measure).catch(() => {});
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", measure);
      window.removeEventListener("pointermove", onPointer);
      ro.disconnect();
    };
  }, []);

  useFrame((_, delta) => {
    const s = state.current;
    s.smooth = THREE.MathUtils.damp(s.smooth, s.y, 7, delta);
    // page height / hero height can still change after the first frames (fonts,
    // the Modrinth grid arriving): ease those too so the camera never jumps
    s.maxSmooth = THREE.MathUtils.damp(s.maxSmooth, s.max, 3, delta);
    s.heroSmooth = THREE.MathUtils.damp(s.heroSmooth, s.hero, 3, delta);
    pointerSmooth.current.x = THREE.MathUtils.damp(pointerSmooth.current.x, pointer.current.x, 3, delta);
    pointerSmooth.current.y = THREE.MathUtils.damp(pointerSmooth.current.y, pointer.current.y, 3, delta);

    const hero = s.framing || (s.framing = heroFraming(size.width, size.height));
    // 0..1 while the hero section scrolls out (hero view -> through the gate)
    const gate = clamp01(s.smooth / s.heroSmooth);
    const gateEase = smoothstep(0, 1, gate);
    // 0..1 over the remaining page (the walk)
    const walk = clamp01((s.smooth - s.heroSmooth) / Math.max(1, s.maxSmooth - s.heroSmooth));

    const camZ = gate < 1 ? THREE.MathUtils.lerp(hero.dist, GATE_PASS_Z, gateEase) : GATE_PASS_Z + (walkEndZ - GATE_PASS_Z) * walk;
    camZRef.current = camZ;
    const bob = Math.sin(s.smooth * 0.006) * 0.03 * gateEase;
    const sway = Math.sin(camZ * 0.045) * 0.3 * gateEase;
    const parallax = 1 - gateEase * 0.6;

    tmp.pos.set(
      sway + pointerSmooth.current.x * 0.35 * parallax,
      THREE.MathUtils.lerp(HERO.y, WALK.y, gateEase) + bob + pointerSmooth.current.y * 0.12 * parallax,
      camZ
    );
    // look target: the gate at the start, the far end of the path later
    tmp.look.set(
      THREE.MathUtils.lerp(0, sway * 0.4, gateEase),
      THREE.MathUtils.lerp(hero.targetY, WALK.lookY, gateEase),
      THREE.MathUtils.lerp(0, camZ - WALK.look, smoothstep(0.15, 0.9, gate))
    );

    camera.position.copy(tmp.pos);
    camera.lookAt(tmp.look);
    const fov = THREE.MathUtils.lerp(hero.fov, hero.walkFov, gateEase);
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  });

  return null;
}

// ---------------------------------------------------------------- housekeeping
// Tells the page the world is really drawing (a few frames in) so it can fade
// the canvas in and let the content sheets turn translucent.
function ReadySignal({ onReady }) {
  const frames = useRef(0);
  useFrame(() => {
    if (frames.current > 6) return;
    frames.current++;
    if (frames.current === 6) onReady?.();
  });
  return null;
}

// Keeps the frame rate healthy on weak GPUs. The pixel ratio lives in React state
// in WorldScene and is handed to <Canvas dpr>, so R3F's own configure() (it runs
// on every resize) can never silently undo a step. Steps down when frames run
// long, back up when there is headroom - but a level that just proved too slow
// stays banned for 30 s and is retried at most twice more. Not while the intro
// plays over the canvas, then a short warm-up (boot hitches: shader compiles).
// If even the lowest step cannot keep up (software rendering, a very weak GPU)
// the world is given up for good and the page falls back to plain paper.
function AdaptiveQuality({ dpr, setDpr, min, top, onGiveUp }) {
  const stat = useRef({ ema: 16, slow: 0, fast: 0, hopeless: 0, age: 0, banned: Infinity, bannedAt: 0, strikes: 0 });

  useFrame((_, rawDelta) => {
    const s = stat.current;
    if (document.documentElement.dataset.introDone !== "true") return;
    // A backgrounded tab returning fires one frame with a multi-second delta
    // (the time it was away, not a slow frame) — cap it everywhere here so a
    // brief tab switch can never read as "hopelessly slow" and kill the world.
    const delta = Math.min(rawDelta, 0.25);
    s.age += delta;
    if (s.age < 2.5) return;
    const ms = delta * 1000;
    s.ema += (ms - s.ema) * 0.05;

    if (s.ema > 26) {
      s.slow += delta;
      s.fast = 0;
    } else if (s.ema < 19) {
      s.fast += delta;
      s.slow = 0;
    } else {
      s.slow = s.fast = 0;
    }
    // hopeless = frames still take > 60 ms at the lowest level (raw deltas: with
    // multi-second frames the smoothed value would take half a minute to notice)
    s.hopeless = dpr <= min && delta > 0.06 ? s.hopeless + delta : dpr <= min ? Math.max(0, s.hopeless - delta) : 0;

    if (s.slow > 1.5 && dpr > min) {
      s.banned = dpr;
      s.bannedAt = s.age;
      s.strikes++;
      s.slow = 0;
      setDpr(Math.max(min, dpr - 0.25));
    } else if (s.fast > 6 && dpr < top && (dpr + 0.25 < s.banned || (s.strikes < 3 && s.age - s.bannedAt > 30))) {
      s.fast = 0;
      setDpr(Math.min(top, dpr + 0.25));
    }
    if (s.hopeless > 4) {
      s.hopeless = -1e9;
      onGiveUp?.();
    }
  });
  return null;
}

function WorldContents({ lite, dpr, setDpr, dprTop, onReady, onGiveUp }) {
  const camZRef = useRef(HERO.dist);
  return (
    <>
      <WorldEnvironment />
      <ToriiGate />
      <Sando />
      <Forest lite={lite} camZRef={camZRef} />
      <Horizon />
      <PetalDrift count={lite ? 160 : 400} bokeh={lite ? 4 : 12} />
      <CameraRig camZRef={camZRef} />
      <AdaptiveQuality dpr={dpr} setDpr={setDpr} min={lite ? 0.75 : 1} top={dprTop} onGiveUp={onGiveUp} />
      <ReadySignal onReady={onReady} />
    </>
  );
}

export default function WorldScene({ lite = false, onReady, onLost, onRestored, onGiveUp }) {
  const dprTop = lite ? 1 : Math.min(1.6, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);
  const [dpr, setDpr] = useState(dprTop);
  // Unmounting a Canvas force-loses its context, which fires webglcontextlost on
  // the dying canvas: events from a scene that is already gone must not count.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return (
    <Canvas
      className="world__canvas"
      flat
      resize={{ scroll: false }}
      dpr={dpr}
      camera={{ position: [0, HERO.y, HERO.dist], fov: HERO.fov, near: 0.1, far: 500 }}
      gl={{ antialias: !lite, alpha: false, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        if (import.meta.env.DEV) {
          // dev-only probe for perf checks: window.__worldStats()
          window.__worldStats = () => ({
            calls: gl.info.render.calls,
            triangles: gl.info.render.triangles,
            geometries: gl.info.memory.geometries,
            textures: gl.info.memory.textures,
            dpr: gl.getPixelRatio(),
          });
        }
        // preventDefault asks the browser to hand the context back; the backdrop
        // shows plain paper meanwhile and remounts the scene once it returns
        gl.domElement.addEventListener("webglcontextlost", (e) => {
          e.preventDefault();
          if (alive.current) onLost?.();
        });
        gl.domElement.addEventListener("webglcontextrestored", () => {
          if (alive.current) onRestored?.();
        });
      }}
    >
      <WorldContents lite={lite} dpr={dpr} setDpr={setDpr} dprTop={dprTop} onReady={onReady} onGiveUp={onGiveUp} />
    </Canvas>
  );
}
