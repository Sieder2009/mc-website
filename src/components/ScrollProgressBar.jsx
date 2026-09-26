import { useEffect, useRef } from "react";
import { gsap, ScrollTrigger, prefersReducedMotion } from "../lib/animation.js";

// A hairline at the very top of the page that fills left-to-right with
// overall scroll progress — cheap, always-visible orientation cue.
export default function ScrollProgressBar() {
  const barRef = useRef(null);

  useEffect(() => {
    if (prefersReducedMotion || !barRef.current) return;

    const trigger = ScrollTrigger.create({
      start: 0,
      end: () => document.documentElement.scrollHeight - window.innerHeight,
      onUpdate: (self) => {
        gsap.set(barRef.current, { scaleX: self.progress });
      },
    });

    return () => trigger.kill();
  }, []);

  return (
    <div className="scroll-progress" aria-hidden="true">
      <div className="scroll-progress__bar" ref={barRef} />
    </div>
  );
}
