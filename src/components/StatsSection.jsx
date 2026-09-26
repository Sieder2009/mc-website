import { useEffect, useRef } from "react";
import SectionHeading from "./SectionHeading.jsx";
import StatCard from "./StatCard.jsx";
import { useReveal } from "../hooks/useReveal.js";
import { gsap, ScrollTrigger, prefersReducedMotion } from "../lib/animation.js";

export default function StatsSection({ stats, level }) {
  const [ref, visible] = useReveal();
  const gridRef = useRef(null);

  useEffect(() => {
    const el = gridRef.current;
    if (!el || prefersReducedMotion) return;
    const ctx = gsap.context(() => {
      ScrollTrigger.batch(".stat-card", {
        start: "top 88%",
        onEnter: (cards) =>
          gsap.from(cards, {
            autoAlpha: 0,
            scale: 0.92,
            y: 20,
            duration: 0.5,
            stagger: 0.09,
            ease: "back.out(1.6)",
            overwrite: true,
          }),
      });
    }, el);
    return () => ctx.revert();
  }, []);

  return (
    <section
      id="statistik"
      ref={ref}
      className={`section reveal ${visible ? "is-visible" : ""}`}
      aria-labelledby="statistik-h"
    >
      <div className="section__inner">
        <SectionHeading level={level} id="statistik-h">
          Statistik
        </SectionHeading>
        <div className="stats-grid" ref={gridRef}>
          {stats.map((stat) => (
            <StatCard key={stat.label} {...stat} />
          ))}
        </div>
      </div>
    </section>
  );
}
