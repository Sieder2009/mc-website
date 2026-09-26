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
      // a thin band across the middle of the viewport: the section crossing it is
      // the current one, however tall it is (an area threshold can never be met by
      // a section taller than two screens)
      { rootMargin: "-45% 0px -45% 0px", threshold: 0 }
    );
    targets.forEach((t) => observer.observe(t));
    return () => observer.disconnect();
  }, [ids]);

  return activeId;
}
