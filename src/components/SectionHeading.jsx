export default function SectionHeading({ level, children, id }) {
  return (
    <div className="section-heading">
      <span className="section-heading__tag badge badge--pop">Level {String(level).padStart(2, "0")}</span>
      <h2 id={id}>{children}</h2>
    </div>
  );
}
