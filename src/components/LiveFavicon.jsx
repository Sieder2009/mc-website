import { useEffect } from "react";
import { prefersReducedMotion } from "../lib/animation.js";
import { skinUrlFor } from "../lib/skin.js";
import { SEAL_GLYPHS } from "../lib/sealGlyphs.js";

const RED = "#b8262a";
const PAPER = "#faf7ee";

// Seconds into every minute: the seal turns over like a coin, the Minecraft
// head looks out for a moment and the seal turns back — the cuckoo of a
// cuckoo clock, once a minute.
const TURN = 0.6;
const HEAD_UNTIL = 3;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// The two classic hanko styles: paper characters cut out of solid red, or
// red characters on paper inside a red frame.
function drawStyle(ctx, glyphs, red) {
  if (red) {
    roundRect(ctx, 0, 0, 64, 64, 7);
    ctx.fillStyle = RED;
    ctx.fill();
    ctx.fillStyle = PAPER;
  } else {
    roundRect(ctx, 2, 2, 60, 60, 6);
    ctx.fillStyle = PAPER;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = RED;
    ctx.stroke();
    ctx.fillStyle = RED;
  }
  ctx.fill(glyphs);
}

// Like a second hand, the other style sweeps in clockwise from 12 o'clock.
// Even minutes ink the seal red, odd minutes wipe it back to paper, so every
// minute starts exactly where the last one ended.
function drawSeal(ctx, glyphs, minute, sweep) {
  const inking = minute % 2 === 0;
  drawStyle(ctx, glyphs, !inking);
  if (sweep <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(32, 32);
  ctx.arc(32, 32, 46, -Math.PI / 2, -Math.PI / 2 + sweep * Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  drawStyle(ctx, glyphs, inking);
  ctx.restore();
}

function drawHead(ctx, head) {
  ctx.save();
  roundRect(ctx, 0, 0, 64, 64, 7);
  ctx.clip();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(head, 0, 0, 64, 64);
  ctx.restore();
}

// 0 = seal up, 1 = head up, in between = mid-turn
function turnAt(seconds) {
  if (seconds < TURN) return seconds / TURN;
  if (seconds < HEAD_UNTIL) return 1;
  if (seconds < HEAD_UNTIL + TURN) return 1 - (seconds - HEAD_UNTIL) / TURN;
  return 0;
}

// The tab icon as a living hanko: 湯瑪斯 re-inks itself in step with the real
// seconds, and the Minecraft head pops out on every full minute. Hidden tabs
// only get a timer once a second, so there it ticks like a real second hand.
export default function LiveFavicon({ minecraftName }) {
  useEffect(() => {
    if (prefersReducedMotion) return;
    // the tab strip is a desktop thing — phones keep the static icon
    if (!window.matchMedia("(pointer: fine)").matches) return;

    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d");
    if (!ctx || typeof Path2D === "undefined") return;
    const glyphs = new Path2D(SEAL_GLYPHS);

    // One live <link> replaces the static icons while this runs.
    const staticIcons = [...document.querySelectorAll('link[rel~="icon"]')];
    const live = document.createElement("link");
    live.rel = "icon";
    live.type = "image/png";
    staticIcons.forEach((link) => link.remove());
    document.head.appendChild(live);

    let head = null;
    const name = (minecraftName || "").trim();
    if (name) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const face = document.createElement("canvas");
        face.width = face.height = 8;
        const fctx = face.getContext("2d");
        fctx.drawImage(img, 8, 8, 8, 8, 0, 0, 8, 8); // face
        fctx.drawImage(img, 40, 8, 8, 8, 0, 0, 8, 8); // hat layer
        try {
          face.toDataURL(); // throws if the skin came without CORS
          head = face;
        } catch {
          // no head then — the seal still runs
        }
      };
      img.src = skinUrlFor(name);
    }

    let lastKey = "";
    function draw(snap) {
      const now = Date.now();
      const minute = Math.floor(now / 60000);
      const seconds = (now % 60000) / 1000;
      let turn = head ? turnAt(seconds) : 0;
      // ~27 fps through a turn; a hidden tab ticking once a second never
      // shows the coin edge-on
      turn = snap ? Math.round(turn) : Math.round(turn * 16) / 16;
      // the sweep moves in whole degrees: ~6 new icons a second, not 60
      const sweep = Math.floor((seconds / 60) * 360) / 360;

      const key = turn >= 0.5 ? `head ${turn}` : `seal ${minute % 2} ${sweep} ${turn}`;
      if (key === lastKey) return;
      lastKey = key;

      ctx.clearRect(0, 0, 64, 64);
      ctx.save();
      if (turn > 0 && turn < 1) {
        const width = Math.max(Math.abs(Math.cos(turn * Math.PI)), 0.04);
        const lift = 1 + 0.06 * Math.sin(turn * Math.PI);
        ctx.translate(32, 32);
        ctx.scale(width * lift, lift);
        ctx.translate(-32, -32);
      }
      if (turn >= 0.5) drawHead(ctx, head);
      else drawSeal(ctx, glyphs, minute, sweep);
      ctx.restore();
      live.href = canvas.toDataURL("image/png");
    }

    let frame = 0;
    let timer = 0;
    function onFrame() {
      draw(false);
      frame = requestAnimationFrame(onFrame);
    }
    function onTick() {
      draw(true);
      timer = setTimeout(onTick, 1015 - (Date.now() % 1000));
    }
    function run() {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      if (document.hidden) onTick();
      else frame = requestAnimationFrame(onFrame);
    }

    run();
    document.addEventListener("visibilitychange", run);

    return () => {
      document.removeEventListener("visibilitychange", run);
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      live.remove();
      staticIcons.forEach((link) => document.head.appendChild(link));
    };
  }, [minecraftName]);

  return null;
}
