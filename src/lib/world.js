import { prefersReducedMotion } from "./animation.js";

// Shared by the backdrop and the intro loader: is the 3D world going to be
// drawn at all, and has it finished its first (heavy) build yet?

// failIfMajorPerformanceCaveat: software renderers (SwiftShader / llvmpipe / WARP —
// VMs, remote desktops, blocklisted GPUs) would run the world at a frame every
// few seconds, so they get the plain paper page instead.
const supportsWebGL = (() => {
  if (typeof window === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const options = { failIfMajorPerformanceCaveat: true };
    const gl = canvas.getContext("webgl2", options) || canvas.getContext("webgl", options);
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
})();

// Tell the page (CSS) that the world is not, or no longer, there: the empty
// scene windows between the sections collapse.
export const setWorldFailed = (failed) => document.documentElement.classList.toggle("world-failed", failed);

// Data-saver mode also skips the world: it is a few hundred kB of code and a
// second or two of CPU that nobody on a metered connection asked for.
const saveData = typeof navigator !== "undefined" && !!navigator.connection?.saveData;

export const wantsWorld = !prefersReducedMotion && !saveData && supportsWebGL;

// Phones and tablets get the same world with fewer trees and petals and a
// pixel ratio capped at 1 — the walk down the path is the point of the page.
export const worldLite =
  typeof window !== "undefined" &&
  (window.matchMedia("(max-width: 720px)").matches || window.matchMedia("(pointer: coarse)").matches);

// The world generates a lot of procedural geometry and textures on the main
// thread the first time it mounts (a second or two). The intro loader holds
// its first frame until that is done — otherwise the intro animation would
// freeze halfway and then skip ahead. Settling twice is harmless.
let release;
export const worldSettled = new Promise((resolve) => {
  release = resolve;
});
export const settleWorld = () => release();
