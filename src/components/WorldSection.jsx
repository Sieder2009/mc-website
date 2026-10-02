import { useEffect, useRef } from "react";
import SectionHeading from "./SectionHeading.jsx";
import Timeline from "./Timeline.jsx";
import Gallery from "./Gallery.jsx";
import { useReveal } from "../hooks/useReveal.js";
import { gsap, batchReveal, prefersReducedMotion } from "../lib/animation.js";

export default function WorldSection({ world, worldHistory, builds, level, onOpenLightbox }) {
  const [ref, visible] = useReveal();
  const metaRef = useRef(null);

  useEffect(() => {
    const el = metaRef.current;
    if (!el || prefersReducedMotion) return;
    const ctx = gsap.context(() => {
      batchReveal(".world-meta > div", { y: 18 }, { start: "top 90%", duration: 0.5, stagger: 0.06 });
    }, el);
    return () => ctx.revert();
  }, []);

  const meta = [
    ["Welt", world.name || "—"],
    ["Version", world.version || "—"],
    ["Modloader", world.modloader || "—"],
    ["Modus", world.gamemode || "—"],
    ["Erstellt", world.createdDate || "—"],
  ];

  const downloadUrl = (world.downloadUrl || "").trim();
  const downloadSize = (world.downloadSize || "").trim();

  return (
    <section
      id="welt"
      ref={ref}
      className={`section reveal ${visible ? "is-visible" : ""}`}
      aria-labelledby="welt-h"
    >
      <div className="section__inner">
        <SectionHeading level={level} id="welt-h">
          Die Welt
        </SectionHeading>

        <dl className="world-meta" ref={metaRef}>
          {meta.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>

        {world.description && <p className="world-description">{world.description}</p>}

        {downloadUrl && (
          <a
            className="btn btn--primary world-download"
            href={downloadUrl}
            download
            rel="noopener"
            target={/^https?:\/\//i.test(downloadUrl) ? "_blank" : undefined}
          >
            <span>Welt herunterladen</span>
            {downloadSize && <span className="world-download__size">({downloadSize})</span>}
          </a>
        )}

        <h3>Zeitleiste</h3>
        <Timeline entries={worldHistory} />

        <h3>Bauwerke</h3>
        <Gallery builds={builds} onOpen={onOpenLightbox} />
      </div>
    </section>
  );
}
