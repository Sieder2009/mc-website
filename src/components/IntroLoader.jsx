import { useLayoutEffect, useRef, useState } from "react";
import { gsap, EASE, prefersReducedMotion } from "../lib/animation.js";
import { useLenis } from "./SmoothScrollProvider.jsx";
import { wantsWorld, worldSettled } from "../lib/world.js";

// Longest the intro waits for the 3D world to finish building (see lib/world.js).
const HOLD_MAX_MS = 8000;

const COLS = 6;
const ROWS = 4;

// A storm of blades tears through the screen (the last two cross in an X
// at the centre and trigger the shatter), then the name crashes in.
const BLADE_COUNT = 7;
const SPARKS_PER_HIT = 8;
const BAR_COUNT = 10;
const KANJI = ["斬", "剣", "鬼", "影", "侍", "刃", "猿"];
const SCRAMBLE_GLYPHS = "猿斬剣刃鬼影侍闇魂刀アフェンマル#%&$?/<>=+*";

// When each blade lands (seconds). Gaps shrink — it speeds up into the X.
const HITS = [0.56, 0.78, 0.96, 1.1, 1.22, 1.3, 1.38];
const MEGA = HITS[HITS.length - 1];

const rand = (min, max) => min + Math.random() * (max - min);
const sign = () => (Math.random() < 0.5 ? -1 : 1);
const pick = (str) => str[Math.floor(Math.random() * str.length)];

function shuffledIndices(count) {
  const arr = Array.from({ length: count }, (_, i) => i);
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// GSAP can't interpolate var(--x), so tokens are read once and turned
// into rgba() strings — that way "transparent red" → "red" stays clean.
function rgba(hex, alpha) {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  if (Number.isNaN(n) || full.length !== 6) return `rgba(184, 38, 42, ${alpha})`;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// A jittered set of grid lines from 0 to 100 (inclusive) — evenly spaced
// on average, nudged hard so the resulting cells are anything but uniform.
function jitteredBreaks(count, jitterFrac = 0.6) {
  const cellSize = 100 / count;
  const breaks = [0];
  for (let i = 1; i < count; i++) {
    const jitter = (Math.random() - 0.5) * cellSize * jitterFrac;
    breaks.push(i * cellSize + jitter);
  }
  breaks.push(100);
  return breaks;
}

// Splits the screen into an irregular grid, then cuts every cell along a
// random diagonal — real glass doesn't break into neat rectangles, so
// neither does this. Two triangles always exactly cover their rectangle,
// so the shards still tile back into a solid screen with no gaps. Each
// shard tumbles around its own centre and gets its own speed, spin and
// size so the explosion never looks the same twice.
function buildShards() {
  const xs = jitteredBreaks(COLS);
  const ys = jitteredBreaks(ROWS);
  const shards = [];

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const [x0, x1] = [xs[col], xs[col + 1]];
      const [y0, y1] = [ys[row], ys[row + 1]];
      const tl = [x0, y0];
      const tr = [x1, y0];
      const bl = [x0, y1];
      const br = [x1, y1];
      const useTLBR = Math.random() < 0.5;
      const triangles = useTLBR ? [[tl, tr, br], [tl, br, bl]] : [[tl, tr, bl], [tr, br, bl]];

      triangles.forEach((points) => {
        const cx = points.reduce((sum, p) => sum + p[0], 0) / 3;
        const cy = points.reduce((sum, p) => sum + p[1], 0) / 3;
        const dx = (cx - 50) / 50;
        const dy = (cy - 50) / 50;
        const fling = rand(120, 300);
        shards.push({
          clip: `polygon(${points.map(([x, y]) => `${x.toFixed(2)}% ${y.toFixed(2)}%`).join(", ")})`,
          origin: `${cx.toFixed(2)}% ${cy.toFixed(2)}%`,
          xPercent: dx * fling + rand(-40, 40),
          yPercent: dy * fling + rand(-40, 40),
          rotate: sign() * rand(90, 540),
          scale: rand(0.15, 2.6),
          dur: rand(0.55, 1.15),
          delay: rand(0, 0.2),
        });
      });
    }
  }
  return shards;
}

const SHARDS = buildShards();

// A plain blade silhouette — tapered point, small guard, short handle.
// Detail doesn't matter much at swipe speed; a clean, bold outline reads
// as "sword" even in a blur.
function SwordArt() {
  return (
    <svg viewBox="0 0 40 400" className="intro-loader__sword-svg" aria-hidden="true">
      <path d="M20 0 L28 44 L25 336 L20 356 L15 336 L12 44 Z" fill="#f2ede4" />
      <rect x="3" y="338" width="34" height="13" rx="3" fill="#18140f" />
      <rect x="13" y="350" width="14" height="38" rx="4" fill="#841c1f" />
    </svg>
  );
}

// Every letter carries its own stack of layers so the timeline can attack
// it from many sides: a scrambling glyph that decodes into the real
// letter, two colour-split "ghosts" for the RGB glitch, and two clipped
// halves that take over when the blade cuts the name in two.
function NameLetters({ name }) {
  return name.split("").map((char, i) =>
    char === " " ? (
      <span className="intro-letter intro-letter--space" key={i}>
        {" "}
      </span>
    ) : (
      <span className="intro-letter" key={i}>
        <span className="intro-letter__ghost intro-letter__ghost--red">{char}</span>
        <span className="intro-letter__ghost intro-letter__ghost--cyan">{char}</span>
        <span className="intro-letter__main">{char}</span>
        <span className="intro-letter__noise">{char}</span>
        <span className="intro-letter__half intro-letter__half--hi">{char}</span>
        <span className="intro-letter__half intro-letter__half--lo">{char}</span>
      </span>
    )
  );
}

// Trauma-style screen shake: every impact adds a short-lived shove, and
// the sum of the live ones drives one continuous random-walk on the stage.
// One non-overlapping tween per step, so there's never a fight over x/y.
function addShakeTrack(tl, target, impulses, from, to, unit) {
  const STEP = 0.04;
  const DECAY = 0.3;
  let shaking = false;
  for (let t = from; t < to; t += STEP) {
    let trauma = 0;
    for (const [at, amp] of impulses) {
      const age = t - at;
      if (age >= 0 && age < DECAY) trauma += amp * unit * (1 - age / DECAY) ** 2;
    }
    trauma = Math.min(trauma, 70 * unit);
    if (trauma < 0.4) {
      if (shaking) {
        tl.to(target, { x: 0, y: 0, rotation: 0, duration: STEP, ease: "none" }, t);
        shaking = false;
      }
      continue;
    }
    tl.to(
      target,
      {
        x: rand(-1, 1) * trauma,
        y: rand(-1, 1) * trauma,
        rotation: rand(-1, 1) * trauma * 0.05,
        duration: STEP,
        ease: "none",
      },
      t
    );
    shaking = true;
  }
  tl.to(target, { x: 0, y: 0, rotation: 0, duration: STEP, ease: "none" }, to);
}

function buildIntro(root, onDone) {
  const q = (sel, scope = root) => gsap.utils.toArray(sel, scope);
  const css = getComputedStyle(root);
  const token = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  const RED = token("--c-red", "#b8262a");
  const PANEL = token("--c-panel", "#faf7ee");

  const W = window.innerWidth;
  const H = window.innerHeight;
  const reach = Math.hypot(W, H) * 0.62;
  const unit = Math.min(1.2, Math.max(0.45, Math.min(W, H) / 900));

  const stage = root.querySelector(".intro-loader__stage");
  const shatter = root.querySelector(".intro-loader__shatter");
  const shardEls = q(".intro-loader__shard");
  const kanjiEls = q(".intro-loader__kanji");
  const slashEls = q(".intro-loader__slash");
  const sparkEls = q(".intro-loader__spark");
  const barEls = q(".intro-loader__bar");
  const bladeEls = q(".intro-loader__sword");
  const glow = root.querySelector(".intro-loader__glow");
  const ring = root.querySelector(".intro-loader__ring");
  const flash = root.querySelector(".intro-loader__flash");
  const nameEl = root.querySelector(".intro-loader__name");
  const nameSlash = root.querySelector(".intro-loader__name-slash");
  const hanko = root.querySelector(".intro-loader__hanko");
  const letterEls = q(".intro-letter:not(.intro-letter--space)");

  const tl = gsap.timeline({ onComplete: onDone });
  const impulses = [];

  const pulseFlash = (at, alpha, dur) =>
    tl.fromTo(
      flash,
      { opacity: alpha },
      { opacity: 0, duration: dur, ease: "power2.out", immediateRender: false, overwrite: "auto" },
      at
    );

  // A short flash of the ring — the shockwave that follows big impacts.
  const pulseRing = (at, size = 7, dur = 0.8) =>
    tl.fromTo(
      ring,
      { scale: 0.1, autoAlpha: 0.9 },
      { scale: size, autoAlpha: 0, duration: dur, ease: "power3.out", immediateRender: false },
      at
    );

  let barCursor = 0;
  const glitchBars = (at, count) => {
    for (let n = 0; n < count; n++) {
      const bar = barEls[barCursor++ % barEls.length];
      tl.set(bar, { autoAlpha: rand(0.4, 0.85), x: 0, y: rand(-H / 2, H / 2), scaleY: rand(0.3, 3.2) }, at).to(
        bar,
        { autoAlpha: 0, x: rand(-80, 80), duration: 0.14, ease: "steps(2)", overwrite: "auto" },
        at
      );
    }
  };

  // ---- initial resting state (applied before the first paint) ----------
  gsap.set(shatter, { autoAlpha: 0 });
  gsap.set(glow, { autoAlpha: 0, scale: 0.6 });
  gsap.set(hanko, { autoAlpha: 0, scale: 3, rotation: -18 });
  gsap.set(nameSlash, { scaleX: 0, autoAlpha: 0 });
  gsap.set(bladeEls, { autoAlpha: 0 });
  gsap.set(slashEls, { scaleX: 0 });

  // ---- 0. the red screen stutters in ------------------------------------
  tl.to(shatter, { autoAlpha: 0.55, duration: 0.08, ease: "none" }, 0.04)
    .to(shatter, { autoAlpha: 1, duration: 0.22, ease: EASE.out }, 0.14);

  // ---- 1. blade storm ---------------------------------------------------
  let angle = rand(0, 360);
  const finaleFlip = Math.random() < 0.5 ? 180 : 0;
  const finaleAngle = rand(24, 42);

  HITS.forEach((hit, i) => {
    const finale = i >= BLADE_COUNT - 2;
    if (finale) {
      angle = finaleFlip + (i === BLADE_COUNT - 2 ? finaleAngle : -finaleAngle);
    } else {
      angle += sign() * rand(70, 150);
    }
    const rad = (angle * Math.PI) / 180;
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    const ox = finale ? rand(-12, 12) : rand(-0.32, 0.32) * W;
    const oy = finale ? rand(-12, 12) : rand(-0.3, 0.3) * H;
    const fly = 0.24;
    const out = 0.16;

    // the blade — accelerates into the impact point, then runs on through
    const blade = bladeEls[i];
    tl.set(
      blade,
      { x: ox - dx * reach, y: oy - dy * reach, rotation: angle + 90, autoAlpha: 1 },
      hit - fly
    )
      .to(blade, { x: ox, y: oy, duration: fly, ease: "power2.in" }, hit - fly)
      .to(blade, { x: ox + dx * reach, y: oy + dy * reach, duration: out, ease: "power1.out" }, hit)
      .set(blade, { autoAlpha: 0 }, hit + out);

    // the cut it leaves behind — cracks pile up until the screen gives way
    const slash = slashEls[i];
    gsap.set(slash, { x: ox, y: oy, rotation: angle });
    tl.to(slash, { scaleX: 1, autoAlpha: 1, duration: 0.07, ease: EASE.out }, hit);

    // a huge kanji slams in behind the cut and burns away
    const kanji = kanjiEls[i];
    gsap.set(kanji, { x: finale ? 0 : ox * 0.6, y: finale ? 0 : oy * 0.6, xPercent: -50, yPercent: -50 });
    tl.fromTo(
      kanji,
      { autoAlpha: finale ? 0.85 : 0.6, scale: finale ? 2.6 : 1.8, rotation: rand(-14, 14) },
      {
        autoAlpha: 0,
        scale: finale ? 1.1 : 1,
        rotation: rand(-8, 8),
        duration: finale ? 0.7 : 0.42,
        ease: "power3.out",
        immediateRender: false,
      },
      hit
    );

    // sparks along and across the cut
    for (let s = 0; s < SPARKS_PER_HIT; s++) {
      const spark = sparkEls[i * SPARKS_PER_HIT + s];
      const sparkAngle = angle + (Math.random() < 0.5 ? 0 : 180) + rand(-38, 38);
      const r = (sparkAngle * Math.PI) / 180;
      const dist = rand(0.1, 0.42) * Math.min(W, H) * (finale ? 1.5 : 1);
      tl.set(spark, { x: ox, y: oy, rotation: sparkAngle + 90, scaleY: 1, autoAlpha: 1 }, hit).to(
        spark,
        {
          x: ox + Math.cos(r) * dist,
          y: oy + Math.sin(r) * dist,
          scaleY: 0.15,
          autoAlpha: 0,
          duration: rand(0.28, 0.55),
          ease: "power3.out",
        },
        hit
      );
    }

    pulseFlash(hit, finale ? 0.26 : 0.13, 0.16);
    glitchBars(hit, finale ? 3 : 2);
    impulses.push([hit, 7 + i * 1.8]);
  });

  // ---- 2. the X lands — the screen comes apart ---------------------------
  impulses.push([MEGA, 44]);
  tl.to(slashEls, { autoAlpha: 0, duration: 0.22, ease: "power1.out" }, MEGA + 0.08);
  tl.to(stage, { scale: 1.05, duration: 0.09, yoyo: true, repeat: 1, ease: "power2.out" }, MEGA);
  pulseFlash(MEGA + 0.02, 0.42, 0.4);
  pulseRing(MEGA);
  tl.to(glow, { autoAlpha: 1, scale: 1, duration: 0.7, ease: EASE.soft }, MEGA + 0.1);

  shardEls.forEach((el, i) => {
    const sh = SHARDS[i];
    tl.to(
      el,
      {
        xPercent: sh.xPercent,
        yPercent: sh.yPercent,
        rotation: sh.rotate,
        scale: sh.scale,
        autoAlpha: 0,
        duration: sh.dur,
        ease: "power3.out",
      },
      MEGA + sh.delay
    );
  });

  // ---- 3. the name crashes in, glyph by glyph ---------------------------
  const L0 = MEGA;
  const STEP = 0.04;
  const order = shuffledIndices(letterEls.length);
  const letters = letterEls.map((el, i) => {
    const start = L0 + order[i] * STEP + rand(0, 0.04);
    const dur = rand(0.45, 0.65);
    return {
      el,
      main: el.querySelector(".intro-letter__main"),
      noise: el.querySelector(".intro-letter__noise"),
      ghostR: el.querySelector(".intro-letter__ghost--red"),
      ghostC: el.querySelector(".intro-letter__ghost--cyan"),
      hi: el.querySelector(".intro-letter__half--hi"),
      lo: el.querySelector(".intro-letter__half--lo"),
      start,
      dur,
      end: start + dur,
      resolve: start + dur * 0.62,
    };
  });
  const LAND = letters.length ? Math.max(...letters.map((l) => l.end)) : L0 + 0.5;

  letters.forEach((l) => {
    const spread = rand(18, 56);
    gsap.set(l.el, {
      autoAlpha: 0,
      x: sign() * rand(0.2, 0.7) * W,
      y: sign() * rand(0.2, 0.7) * H,
      rotation: sign() * rand(180, 720),
      scale: rand(0.3, 3),
      filter: "blur(14px)",
    });
    gsap.set(l.main, { color: rgba(RED, 0) });
    gsap.set([l.hi, l.lo], { autoAlpha: 0 });
    gsap.set(l.ghostR, { x: -spread });
    gsap.set(l.ghostC, { x: spread });

    // flight: arrives from a random spot, spinning and out of focus
    tl.set(l.el, { autoAlpha: 1 }, l.start)
      .to(
        l.el,
        { x: 0, y: 0, rotation: 0, scale: 1, filter: "blur(0px)", duration: l.dur, ease: "power4.out" },
        l.start
      )
      .set([l.noise, l.ghostR, l.ghostC], { autoAlpha: 0.9 }, l.start)
      .to(l.ghostR, { x: -3, duration: l.dur, ease: "power3.out" }, l.start)
      .to(l.ghostC, { x: 3, duration: l.dur, ease: "power3.out" }, l.start);

    // impact: the glyph resolves into the real letter with a punch and a
    // hot red flash, then cools to the paper colour.
    tl.set(l.noise, { autoAlpha: 0 }, l.resolve)
      .set(l.main, { autoAlpha: 1 }, l.resolve)
      .to([l.ghostR, l.ghostC], { autoAlpha: 0.55, duration: 0.3 }, l.resolve)
      .fromTo(
        l.main,
        { scale: 1.5 },
        { scale: 1, duration: 0.4, ease: "back.out(2.4)", immediateRender: false },
        l.resolve
      )
      .to(l.main, { color: rgba(RED, 1), duration: 0.06 }, l.resolve)
      .to(l.main, { color: PANEL, duration: 0.35, ease: "power2.out" }, l.resolve + 0.08);
    impulses.push([l.resolve, 5]);
  });

  // While letters are in flight their placeholder glyph keeps changing —
  // kanji, katakana, symbols — until it locks onto the real character.
  const flicker = letters.map(() => 0);
  tl.to(
    {},
    {
      duration: LAND - L0,
      ease: "none",
      onUpdate() {
        const now = tl.time();
        letters.forEach((l, i) => {
          if (now < l.start || now >= l.resolve || now < flicker[i]) return;
          l.noise.textContent = pick(SCRAMBLE_GLYPHS);
          flicker[i] = now + 0.045;
        });
      },
    },
    L0
  );

  // Glitch bursts — colour ghosts tear apart, letters skew and stutter.
  const glitch = (at) => {
    const STEPS = 4;
    const SD = 0.045;
    const ready = letters.filter((l) => at >= l.end);
    shuffledIndices(ready.length)
      .slice(0, Math.ceil(ready.length * 0.7))
      .forEach((idx) => {
        const l = ready[idx];
        for (let s = 0; s < STEPS; s++) {
          const a = rand(8, 30);
          const t = at + s * SD;
          tl.to(l.ghostR, { x: -3 - a * sign(), skewX: rand(-16, 16), duration: SD, ease: "none" }, t)
            .to(l.ghostC, { x: 3 + a * sign(), skewX: rand(-16, 16), duration: SD, ease: "none" }, t)
            .to(l.main, { x: rand(-7, 7), skewX: rand(-12, 12), duration: SD, ease: "none" }, t);
        }
        const t = at + STEPS * SD;
        tl.to(l.ghostR, { x: -3, skewX: 0, duration: SD, ease: "none" }, t)
          .to(l.ghostC, { x: 3, skewX: 0, duration: SD, ease: "none" }, t)
          .to(l.main, { x: 0, skewX: 0, duration: SD, ease: "none" }, t);
      });
    glitchBars(at, 2);
  };
  glitch(LAND - 0.34);
  glitch(LAND - 0.06);

  // ---- 4. a last blade cuts the name in two -----------------------------
  const SLICE_BLADE = LAND - 0.05;
  const SLICE_HIT = SLICE_BLADE + 0.2;
  const SLOPE = -0.17;
  const CUT_SLIDE = 0.09; // how far each half slides along the cut (em)
  const CUT_GAP = 0.035; // and how far it opens up across it (em)
  const geo = { ux: 1, uy: 0, nx: 0, ny: -1, cx: 0, cy: 0, width: 1, deg: 0, em: 100 };

  // Measured lazily, right before the cut, so it reflects whatever the
  // layout (and web font) actually ended up as.
  tl.call(
    () => {
      const rect = nameEl.getBoundingClientRect();
      const height = letterEls[0]?.offsetHeight ?? 0;
      const xc = nameEl.offsetWidth / 2;
      // name-space y of the cut at the centre of the word
      const yc = (letterEls[0]?.offsetTop ?? 0) + height * 0.52;
      const norm = Math.hypot(1, SLOPE);

      geo.em = parseFloat(getComputedStyle(nameEl).fontSize) || 100;
      geo.width = nameEl.offsetWidth;
      geo.deg = (Math.atan(SLOPE) * 180) / Math.PI;
      geo.ux = 1 / norm;
      geo.uy = SLOPE / norm;
      geo.nx = SLOPE / norm; // "up" normal of the cut line
      geo.ny = -1 / norm;
      geo.cx = rect.left + rect.width / 2 - W / 2;
      geo.cy = rect.top + yc - H / 2;

      const margin = 60;
      letterEls.forEach((el, i) => {
        const l = letters[i];
        const lx = el.offsetLeft;
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        const top = el.offsetTop;
        const lineY = (x) => yc + SLOPE * (x - xc) - top;
        const ya = lineY(lx - margin);
        const yb = lineY(lx + w + margin);
        const xa = -margin;
        const xb = w + margin;
        gsap.set(l.hi, {
          clipPath: `polygon(${xa}px ${ya}px, ${xb}px ${yb}px, ${xb}px ${-h * 2}px, ${xa}px ${-h * 2}px)`,
        });
        gsap.set(l.lo, {
          clipPath: `polygon(${xa}px ${ya}px, ${xb}px ${yb}px, ${xb}px ${h * 3}px, ${xa}px ${h * 3}px)`,
        });
      });
      gsap.set(nameSlash, { y: yc, rotation: geo.deg });
    },
    null,
    SLICE_BLADE - 0.02
  );

  const cutBlade = bladeEls[BLADE_COUNT];
  tl.set(
    cutBlade,
    {
      x: () => geo.cx - geo.ux * reach,
      y: () => geo.cy - geo.uy * reach,
      rotation: () => geo.deg + 90,
      autoAlpha: 1,
    },
    SLICE_BLADE
  )
    .to(
      cutBlade,
      { x: () => geo.cx, y: () => geo.cy, duration: 0.2, ease: "power2.in" },
      SLICE_BLADE
    )
    .to(
      cutBlade,
      { x: () => geo.cx + geo.ux * reach, y: () => geo.cy + geo.uy * reach, duration: 0.16, ease: "power1.out" },
      SLICE_HIT
    )
    .set(cutBlade, { autoAlpha: 0 }, SLICE_HIT + 0.16);

  // the cut line flashes, the name swaps to its two halves and they slide
  // apart along the cut.
  tl.to(nameSlash, { scaleX: 1, autoAlpha: 1, duration: 0.07, ease: EASE.out }, SLICE_HIT)
    .to(nameSlash, { autoAlpha: 0, duration: 0.5, ease: "power2.in" }, SLICE_HIT + 0.12);
  pulseFlash(SLICE_HIT, 0.2, 0.2);
  impulses.push([SLICE_HIT, 22]);

  letters.forEach((l) => {
    tl.set([l.main, l.ghostR, l.ghostC], { autoAlpha: 0 }, SLICE_HIT)
      .set([l.hi, l.lo], { autoAlpha: 1 }, SLICE_HIT)
      .to(
        l.hi,
        {
          x: () => (geo.ux * CUT_SLIDE + geo.nx * CUT_GAP) * geo.em,
          y: () => (geo.uy * CUT_SLIDE + geo.ny * CUT_GAP) * geo.em,
          duration: 0.22,
          ease: "power3.out",
        },
        SLICE_HIT
      )
      .to(
        l.lo,
        {
          x: () => -(geo.ux * CUT_SLIDE + geo.nx * CUT_GAP) * geo.em,
          y: () => -(geo.uy * CUT_SLIDE + geo.ny * CUT_GAP) * geo.em,
          duration: 0.22,
          ease: "power3.out",
        },
        SLICE_HIT
      );
  });

  const cutSparkBase = BLADE_COUNT * SPARKS_PER_HIT;
  for (let s = 0; s < SPARKS_PER_HIT; s++) {
    const spark = sparkEls[cutSparkBase + s];
    const along = rand(-0.45, 0.45);
    const fling = rand(0.08, 0.3) * Math.min(W, H);
    const dir = Math.random() < 0.5 ? 1 : -1;
    tl.set(
      spark,
      {
        x: () => geo.cx + geo.ux * along * geo.width,
        y: () => geo.cy + geo.uy * along * geo.width,
        rotation: () => geo.deg + (dir > 0 ? 0 : 180) + rand(-50, 50) + 90,
        scaleY: 1,
        autoAlpha: 1,
      },
      SLICE_HIT
    ).to(
      spark,
      {
        x: () => geo.cx + geo.ux * along * geo.width + geo.nx * dir * fling,
        y: () => geo.cy + geo.uy * along * geo.width + geo.ny * dir * fling,
        scaleY: 0.15,
        autoAlpha: 0,
        duration: rand(0.3, 0.55),
        ease: "power3.out",
      },
      SLICE_HIT
    );
  }

  // ---- 5. the seal is stamped -------------------------------------------
  const HANKO = SLICE_HIT + 0.3;
  tl.to(hanko, { scale: 1, rotation: -6, autoAlpha: 1, duration: 0.16, ease: "power4.in" }, HANKO)
    .to(hanko, { scale: 0.9, duration: 0.06, ease: "power1.out" }, HANKO + 0.16)
    .to(hanko, { scale: 1, duration: 0.3, ease: "elastic.out(1, 0.4)" }, HANKO + 0.22);
  impulses.push([HANKO + 0.16, 30]);
  pulseRing(HANKO + 0.16, 4, 0.6);
  pulseFlash(HANKO + 0.16, 0.14, 0.2);

  // ---- 6. exit: the halves blow apart, everything clears ----------------
  const EXIT = HANKO + 0.8;
  impulses.push([EXIT, 14]);
  letters.forEach((l) => {
    const push = rand(0.4, 1.3) * Math.max(W, H) * 0.35;
    const lift = rand(0.2, 0.9) * Math.max(W, H) * 0.25;
    const spin = sign() * rand(20, 110);
    tl.to(
      l.hi,
      {
        x: () => geo.ux * push + geo.nx * lift,
        y: () => geo.uy * push + geo.ny * lift,
        rotation: spin,
        autoAlpha: 0,
        duration: 0.6,
        ease: "power3.in",
      },
      EXIT
    ).to(
      l.lo,
      {
        x: () => -geo.ux * push - geo.nx * lift,
        y: () => -geo.uy * push - geo.ny * lift,
        rotation: -spin,
        autoAlpha: 0,
        duration: 0.6,
        ease: "power3.in",
      },
      EXIT
    );
  });
  tl.to(hanko, { scale: 1.7, autoAlpha: 0, duration: 0.3, ease: "power2.in" }, EXIT)
    .to(glow, { autoAlpha: 0, duration: 0.5, ease: "power2.in" }, EXIT)
    .to(root, { autoAlpha: 0, duration: 0.55, ease: "power2.inOut" }, EXIT + 0.15);

  addShakeTrack(tl, stage, impulses, 0.3, EXIT + 0.35, unit);

  if (import.meta.env.DEV) window.__introTimeline = tl;
  return tl;
}

export default function IntroLoader({ name }) {
  const rootRef = useRef(null);
  const lenisRef = useLenis();
  const [visible, setVisible] = useState(!prefersReducedMotion);

  // Layout effect: the resting state of every layer has to be in place
  // before the first paint, or the name would flash for a frame.
  useLayoutEffect(() => {
    let released = false;

    function releaseAndHide() {
      if (released) return;
      released = true;
      document.documentElement.classList.remove("no-scroll");
      document.documentElement.dataset.introDone = "true";
      lenisRef?.current?.start();
      window.dispatchEvent(new Event("introdone"));
      setVisible(false);
    }

    // Nothing was ever rendered in this case (see useState above) — just
    // fire the release signal so Hero's own entrance isn't left waiting.
    if (prefersReducedMotion) {
      releaseAndHide();
      return;
    }

    const root = rootRef.current;
    if (!root) return;

    document.documentElement.classList.add("no-scroll");
    lenisRef?.current?.stop();

    let tl;
    let cancelled = false;
    const ctx = gsap.context(() => {
      try {
        tl = buildIntro(root, releaseAndHide);
      } catch (error) {
        // never leave the page locked behind a broken intro
        console.error("Intro animation failed:", error);
        releaseAndHide();
      }
    }, root);

    // Hold the first (solid red) frame while the 3D world does its heavy
    // first build, so the animation plays smoothly instead of freezing
    // halfway. Never longer than HOLD_MAX_MS.
    let holdTimer = 0;
    if (tl && wantsWorld) {
      tl.pause(0);
      root.classList.add("is-holding");
      const timeout = new Promise((resolve) => {
        holdTimer = setTimeout(resolve, HOLD_MAX_MS);
      });
      Promise.race([worldSettled, timeout]).then(() => {
        clearTimeout(holdTimer);
        if (cancelled) return;
        root.classList.remove("is-holding");
        tl.play();
      });
    }

    return () => {
      cancelled = true;
      clearTimeout(holdTimer);
      ctx.revert();
    };
  }, [lenisRef]);

  if (!visible) return null;

  return (
    <div className="intro-loader" ref={rootRef} aria-hidden="true">
      <div className="intro-loader__stage">
        <div className="intro-loader__shatter">
          {SHARDS.map((shard, i) => (
            <div
              key={i}
              className="intro-loader__shard"
              style={{ clipPath: shard.clip, transformOrigin: shard.origin }}
            />
          ))}
        </div>

        {KANJI.map((glyph) => (
          <div key={glyph} className="intro-loader__kanji">
            {glyph}
          </div>
        ))}

        {Array.from({ length: BLADE_COUNT }, (_, i) => (
          <div key={i} className="intro-loader__slash" />
        ))}

        <div className="intro-loader__glow" />

        {Array.from({ length: BAR_COUNT }, (_, i) => (
          <div
            key={i}
            className={`intro-loader__bar ${i % 2 ? "intro-loader__bar--dark" : "intro-loader__bar--light"}`}
          />
        ))}

        {Array.from({ length: (BLADE_COUNT + 1) * SPARKS_PER_HIT }, (_, i) => (
          <div key={i} className="intro-loader__spark" />
        ))}

        {Array.from({ length: BLADE_COUNT + 1 }, (_, i) => (
          <div key={i} className="intro-loader__sword">
            <SwordArt />
          </div>
        ))}

        <p className="intro-loader__name">
          <NameLetters name={name} />
          <span className="intro-loader__name-slash" />
          <span className="intro-loader__hanko">猿</span>
        </p>

        <div className="intro-loader__ring" />
      </div>

      <div className="intro-loader__flash" />
    </div>
  );
}
