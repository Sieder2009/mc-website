import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

export { gsap, ScrollTrigger };

export const EASE = {
  out: "power4.out",
  soft: "power3.out",
  inOut: "power2.inOut",
};

export const NO_MOTION_PREF = "(prefers-reduced-motion: no-preference)";

export const prefersReducedMotion =
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Fades a group of elements in the first time each one scrolls into view.
// fromTo with explicit end values + once: a bare gsap.from() re-run on every
// re-entry takes a card that is still mid-tween as its new resting place and
// leaves it stuck half-shifted (and half-transparent). clearProps hands the
// transform back to the stylesheet afterwards, so CSS :hover lifts work again.
export function batchReveal(targets, from, { start = "top 88%", duration = 0.55, stagger = 0.08, ease = EASE.soft } = {}) {
  const settled = { autoAlpha: 1 };
  if ("x" in from) settled.x = 0;
  if ("y" in from) settled.y = 0;
  if ("scale" in from) settled.scale = 1;

  return ScrollTrigger.batch(targets, {
    start,
    once: true,
    onEnter: (elements) =>
      gsap.fromTo(
        elements,
        { autoAlpha: 0, ...from },
        { ...settled, duration, stagger, ease, overwrite: true, clearProps: "transform,opacity,visibility" }
      ),
  });
}
