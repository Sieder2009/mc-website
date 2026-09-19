import SectionHeading from "./SectionHeading.jsx";
import { useReveal } from "../hooks/useReveal.js";

export default function ContactSection({ contact, level }) {
  const [ref, visible] = useReveal();
  const { label, value, type } = contact || {};

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
        <p className="contact-line">
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
