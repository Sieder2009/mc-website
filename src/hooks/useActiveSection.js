import { useEffect, useState } from "react";

// Tracks which of the given section ids is currently in view, for the
// right-edge chapter-number nav.
export function useActiveSection(ids) {
  const [activeId, setActiveId] = useState(ids[0] ?? null);

  useEffect(() => {
    if (!("IntersectionObserver" in window)) return;
    const targets = ids
      .map((id) => document.getElementById(id))
      .filter(Boolean);
    if (targets.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActiveId(entry.target.id);
        });
      },
      { threshold: 0.5 }
    );
    targets.forEach((t) => observer.observe(t));
    return () => observer.disconnect();
  }, [ids]);

  return activeId;
}
