import { useActiveSection } from "../hooks/useActiveSection.js";

export default function SectionDots({ items }) {
  const ids = items.map((i) => i.href.slice(1));
  const activeId = useActiveSection(ids);

  if (items.length === 0) return null;

  return (
    <nav className="section-dots" aria-label="Abschnitte">
      {items.map((item) => {
        const id = item.href.slice(1);
        return (
          <a
            key={id}
            href={item.href}
            className={`section-dots__dot ${activeId === id ? "is-active" : ""}`}
            aria-label={item.label}
          />
        );
      })}
    </nav>
  );
}
