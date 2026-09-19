import { useState } from "react";
import SectionHeading from "./SectionHeading.jsx";
import { useReveal } from "../hooks/useReveal.js";

export default function ServerSection({ address, level }) {
  const [ref, visible] = useReveal();
  const [copyStatus, setCopyStatus] = useState("");

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
        <div className="server-box">
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
