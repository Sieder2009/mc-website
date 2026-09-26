import { useEffect, useRef } from "react";
import { gsap, ScrollTrigger, prefersReducedMotion } from "../lib/animation.js";

export default function Gallery({ builds, onOpen }) {
  const gridRef = useRef(null);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || prefersReducedMotion) return;

    const ctx = gsap.context(() => {
      ScrollTrigger.batch(".gallery__card", {
        start: "top 88%",
        onEnter: (cards) =>
          gsap.from(cards, {
            autoAlpha: 0,
            y: 32,
            duration: 0.6,
            stagger: 0.08,
            ease: "power3.out",
            overwrite: true,
          }),
      });

      // each build photo drifts slower than the page scroll — the extra
      // 16%/side headroom on .gallery__media img (see index.css) is what
      // keeps this from ever exposing a gap at the edges.
      gsap.utils.toArray(".gallery__card:not(.gallery__card--empty) img").forEach((img) => {
        gsap.fromTo(
          img,
          { y: -26 },
          {
            y: 26,
            ease: "none",
            scrollTrigger: {
              trigger: img.closest(".gallery__card"),
              start: "top bottom",
              end: "bottom top",
              scrub: 0.6,
            },
          }
        );
      });
    }, grid);

    return () => ctx.revert();
  }, [builds]);

  return (
    <div className="gallery" ref={gridRef}>
      {builds.map((build, i) => {
        if (!build.image) {
          return (
            <article className="gallery__card gallery__card--empty" key={i}>
              <div className="gallery__media">Bild folgt</div>
              <div className="gallery__body">
                <h4>{build.title || "Bauwerk folgt"}</h4>
              </div>
            </article>
          );
        }

        const caption = build.alt || build.title || "Bauwerk-Bild";
        return (
          <article className="gallery__card" key={i}>
            <button
              type="button"
              className="gallery__media"
              onClick={() => onOpen(build.image, caption)}
            >
              <img src={build.image} alt={caption} loading="lazy" decoding="async" />
            </button>
            <div className="gallery__body">
              <h4>{build.title || "Bauwerk folgt"}</h4>
              {build.description && <p>{build.description}</p>}
              {build.coordinates && <span className="gallery__coords">{build.coordinates}</span>}
            </div>
          </article>
        );
      })}
    </div>
  );
}
