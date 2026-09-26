import { createContext, useContext, useEffect, useRef } from "react";
import Lenis from "lenis";
import { gsap, ScrollTrigger, prefersReducedMotion } from "../lib/animation.js";

const LenisContext = createContext(null);

// Lets things like the lightbox pause/resume Lenis's own scroll loop —
// document.body.style.overflow alone doesn't stop it, since Lenis drives
// window.scrollTo() itself rather than relying on native overflow clipping.
export function useLenis() {
  return useContext(LenisContext);
}

// Feeds Lenis's smooth-scroll physics into GSAP's ticker so ScrollTrigger
// reads the same eased scroll position everything else animates against.
// Skipped entirely under reduced motion — native (instant) scroll stays in
// charge, matching html { scroll-behavior } already set for that case.
export default function SmoothScrollProvider({ children }) {
  const lenisRef = useRef(null);

  useEffect(() => {
    if (prefersReducedMotion) return;

    const lenis = new Lenis({
      duration: 1.1,
      smoothWheel: true,
      anchors: true,
      autoRaf: false,
    });
    lenisRef.current = lenis;
    // The intro loader locks scrolling in its layout effect, which runs before
    // this one — so its lenis.stop() found no instance yet. Honour the lock here.
    if (document.documentElement.classList.contains("no-scroll")) lenis.stop();

    lenis.on("scroll", ScrollTrigger.update);
    const tick = (time) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    ScrollTrigger.config({ ignoreMobileResize: true });

    const refresh = () => ScrollTrigger.refresh();
    document.fonts?.ready.then(refresh).catch(() => {});

    return () => {
      gsap.ticker.remove(tick);
      lenis.destroy();
      lenisRef.current = null;
    };
  }, []);

  return <LenisContext.Provider value={lenisRef}>{children}</LenisContext.Provider>;
}
