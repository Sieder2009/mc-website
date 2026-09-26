import { useEffect, useRef, useState } from "react";
import SectionHeading from "./SectionHeading.jsx";
import { useReveal } from "../hooks/useReveal.js";
import { gsap, ScrollTrigger, prefersReducedMotion } from "../lib/animation.js";

export default function ServerSection({ address, level }) {
  const [ref, visible] = useReveal();
  const [copyStatus, setCopyStatus] = useState("");
  const boxRef = useRef(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || prefersReducedMotion) return;
    const trigger = ScrollTrigger.create({
      trigger: el,
      start: "top 90%",
      once: true,
      onEnter: () =>
        gsap.from(el, { autoAlpha: 0, y: 20, scale: 0.96, duration: 0.55, ease: "power3.out" }),
    });
    return () => trigger.kill();
  }, []);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopyStatus("Serveradresse kopiert.");
    } catch {
      setCopyStatus("Kopieren nicht möglich — bitte manuell auswählen.");
    }
  }

  return (
    <section
      id="server"
      ref={ref}
      className={`section reveal ${visible ? "is-visible" : ""}`}
      aria-labelledby="server-h"
    >
      <div className="section__inner">
        <SectionHeading level={level} id="server-h">
          Server
        </SectionHeading>
        <div className="server-box" ref={boxRef}>
          <code>{address}</code>
          <button type="button" className="btn btn--small" onClick={handleCopy}>
            Kopieren
          </button>
        </div>
        <p className="sr-only" role="status" aria-live="polite">
          {copyStatus}
        </p>
      </div>
    </section>
  );
}
