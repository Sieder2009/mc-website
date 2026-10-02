import { useEffect, useRef, useState } from "react";

const prefersReducedMotion =
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Fades/slides a section in the first time it crosses the viewport.
// Returns a ref to attach and a boolean for the "visible" class.
export function useReveal() {
  const ref = useRef(null);
  const [visible, setVisible] = useState(prefersReducedMotion);

  useEffect(() => {
    if (prefersReducedMotion || !("IntersectionObserver" in window)) {
      setVisible(true);
      return;
    }
    const el = ref.current;
    if (!el) return;

    // Not a threshold share of the section's own height: a section taller
    // than ~6 screens (the long timeline + gallery on a phone) could never
    // show 15% of itself at once and would stay invisible. Instead it counts
    // as soon as any part of it is in the upper 85% of the viewport.
    const observer = new IntersectionObserver(
      ([entry], obs) => {
        if (entry.isIntersecting) {
          setVisible(true);
          obs.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -15% 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, visible];
}
