import { useEffect, useRef } from "react";
import { gsap, prefersReducedMotion } from "../lib/animation.js";

// Wraps a single link/button and nudges it toward the cursor while
// hovered, like a soft magnet — desktop-with-a-mouse only.
export default function MagneticLink({ as: Tag = "a", className = "", children, ...props }) {
  const ref = useRef(null);

  useEffect(() => {
    if (prefersReducedMotion) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;
    const el = ref.current;
    if (!el) return;

    const moveX = gsap.quickTo(el, "x", { duration: 0.5, ease: "power3.out" });
    const moveY = gsap.quickTo(el, "y", { duration: 0.5, ease: "power3.out" });

    function onMove(e) {
      const rect = el.getBoundingClientRect();
      const relX = e.clientX - (rect.left + rect.width / 2);
      const relY = e.clientY - (rect.top + rect.height / 2);
      moveX(relX * 0.35);
      moveY(relY * 0.35);
    }

    function onLeave() {
      moveX(0);
      moveY(0);
    }

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <Tag ref={ref} className={`magnetic ${className}`} {...props}>
      {children}
    </Tag>
  );
}
