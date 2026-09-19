import { useCounter } from "../hooks/useCounter.js";

export default function StatCard({ label, value, suffix }) {
  const [ref, current] = useCounter(value);
  return (
    <div className="stat-card" ref={ref}>
      <span className="stat-card__value">
        {current}
        {typeof value === "number" ? suffix : ""}
      </span>
      <span className="stat-card__label">{label}</span>
    </div>
  );
}
