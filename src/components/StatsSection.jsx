import SectionHeading from "./SectionHeading.jsx";
import StatCard from "./StatCard.jsx";
import { useReveal } from "../hooks/useReveal.js";

export default function StatsSection({ stats, level }) {
  const [ref, visible] = useReveal();
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
        <div className="stats-grid">
          {stats.map((stat) => (
            <StatCard key={stat.label} {...stat} />
          ))}
        </div>
      </div>
    </section>
  );
}
