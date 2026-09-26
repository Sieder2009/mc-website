import { useEffect, useRef } from "react";
import { gsap, ScrollTrigger, prefersReducedMotion } from "../lib/animation.js";
import SplitLetters from "./SplitLetters.jsx";

export default function SectionHeading({ level, children, id }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion) return;

    const ctx = gsap.context(() => {
      const letters = el.querySelectorAll(".split-letter");
      gsap.set(letters, { yPercent: 110 });
      gsap.set(".section-heading__tag", { autoAlpha: 0, y: 10 });
      ScrollTrigger.create({
        trigger: el,
        start: "top 85%",
        once: true,
        onEnter: () => {
          gsap
            .timeline({ defaults: { ease: "power4.out" } })
            .to(".section-heading__tag", { autoAlpha: 1, y: 0, duration: 0.5 }, 0)
            .to(letters, { yPercent: 0, duration: 0.7, stagger: 0.025 }, 0.1);
        },
      });
    }, el);

    return () => ctx.revert();
  }, []);

  return (
    <div className="section-heading" ref={ref}>
      <span className="section-heading__tag badge badge--pop">Level {String(level).padStart(2, "0")}</span>
      <h2 id={id}>
        <SplitLetters text={children} />
      </h2>
    </div>
  );
}
