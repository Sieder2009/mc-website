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
