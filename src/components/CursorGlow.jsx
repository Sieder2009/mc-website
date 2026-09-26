import { useEffect, useRef } from "react";
import { gsap, prefersReducedMotion } from "../lib/animation.js";

// A soft red glow that drifts toward the pointer — desktop-with-a-mouse
// only (fine pointer), skipped for touch devices and reduced motion.
export default function CursorGlow() {
  const glowRef = useRef(null);

  useEffect(() => {
    if (prefersReducedMotion) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;
    const el = glowRef.current;
    if (!el) return;

    gsap.set(el, { xPercent: -50, yPercent: -50 });
    const moveX = gsap.quickTo(el, "x", { duration: 0.7, ease: "power3.out" });
    const moveY = gsap.quickTo(el, "y", { duration: 0.7, ease: "power3.out" });

    function onMove(e) {
      moveX(e.clientX);
      moveY(e.clientY);
    }

    function onEnter() {
      gsap.to(el, { opacity: 1, duration: 0.4 });
    }

    function onLeave() {
      gsap.to(el, { opacity: 0, duration: 0.4 });
    }

    window.addEventListener("pointermove", onMove);
    document.documentElement.addEventListener("pointerenter", onEnter);
    document.documentElement.addEventListener("pointerleave", onLeave);

    return () => {
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerenter", onEnter);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return <div className="cursor-glow" ref={glowRef} aria-hidden="true" />;
}
