import { useEffect, useRef } from "react";
import { gsap, ScrollTrigger, prefersReducedMotion } from "../lib/animation.js";

export default function Timeline({ entries }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion || !entries || entries.length === 0) return;

    const ctx = gsap.context(() => {
      // the red line fills in as you scroll past the entries, like ink
      // tracing the timeline's own spine.
      gsap.fromTo(
        ".timeline__progress",
        { scaleY: 0 },
        {
          scaleY: 1,
          ease: "none",
          scrollTrigger: { trigger: el, start: "top 75%", end: "bottom 60%", scrub: 0.4 },
        }
      );

      ScrollTrigger.batch(".timeline li", {
        start: "top 88%",
        onEnter: (items) =>
          gsap.from(items, {
            autoAlpha: 0,
            x: -16,
            duration: 0.55,
            stagger: 0.12,
            ease: "power3.out",
            overwrite: true,
          }),
      });
    }, el);

    return () => ctx.revert();
  }, [entries]);

  if (!entries || entries.length === 0) return null;

  return (
    <div className="timeline-wrap" ref={ref}>
      <span className="timeline__progress" aria-hidden="true" />
      <ol className="timeline">
        {entries.map((entry, i) => (
          <li key={i}>
            <time>{entry.date}</time>
            <h4>{entry.title}</h4>
            <p>{entry.text}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
