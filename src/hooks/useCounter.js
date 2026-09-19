import { useEffect, useRef, useState } from "react";

const prefersReducedMotion =
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Animates 0 -> target with an ease-out curve once the element scrolls
// into view. `target` may be null (renders "–" and never animates).
export function useCounter(target) {
  const ref = useRef(null);
  const [value, setValue] = useState(target === null ? "–" : 0);

  useEffect(() => {
    if (target === null || target === undefined) return;
    if (prefersReducedMotion || !("IntersectionObserver" in window)) {
      setValue(target);
      return;
    }
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry], obs) => {
        if (!entry.isIntersecting) return;
        obs.unobserve(entry.target);
        const duration = 1200;
        const start = performance.now();
        function tick(now) {
          const progress = Math.min((now - start) / duration, 1);
          const eased = 1 - Math.pow(1 - progress, 3);
          setValue(Math.round(target * eased));
          if (progress < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      },
      { threshold: 0.4 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [target]);

  return [ref, value];
}
