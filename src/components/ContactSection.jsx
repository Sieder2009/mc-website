import { useEffect, useRef } from "react";
import SectionHeading from "./SectionHeading.jsx";
import { useReveal } from "../hooks/useReveal.js";
import { gsap, ScrollTrigger, prefersReducedMotion } from "../lib/animation.js";

export default function ContactSection({ contact, level }) {
  const [ref, visible] = useReveal();
  const { label, value, type } = contact || {};
  const lineRef = useRef(null);

  useEffect(() => {
    const el = lineRef.current;
    if (!el || prefersReducedMotion) return;
    const trigger = ScrollTrigger.create({
      trigger: el,
      start: "top 90%",
      once: true,
      onEnter: () => gsap.from(el, { autoAlpha: 0, y: 16, duration: 0.5, ease: "power3.out" }),
    });
    return () => trigger.kill();
  }, []);

  function handleEmailClick(e) {
    e.preventDefault();
    const [user, domain] = value.split("@");
    window.location.href = `mailto:${user}@${domain}`;
  }

  return (
    <section
      id="kontakt"
      ref={ref}
      className={`section reveal ${visible ? "is-visible" : ""}`}
      aria-labelledby="kontakt-h"
    >
      <div className="section__inner">
        <SectionHeading level={level} id="kontakt-h">
          Kontakt
        </SectionHeading>
        <p className="contact-line" ref={lineRef}>
          {!value ? (
            "Kontaktangaben folgen."
          ) : type === "email" ? (
            <>
              {label}: <a href="#" onClick={handleEmailClick}>{value}</a>
            </>
          ) : (
            `${label}: ${value}`
          )}
        </p>
      </div>
    </section>
  );
}
