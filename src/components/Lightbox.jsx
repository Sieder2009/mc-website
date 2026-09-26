import { useEffect, useRef } from "react";
import { useLenis } from "./SmoothScrollProvider.jsx";

function getFocusable(container) {
  return Array.from(
    container.querySelectorAll(
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
    )
  );
}

export default function Lightbox({ state, onClose }) {
  const dialogRef = useRef(null);
  const closeBtnRef = useRef(null);
  const lenisRef = useLenis();

  useEffect(() => {
    if (!state) return;
    closeBtnRef.current?.focus();
    document.body.style.overflow = "hidden";
    lenisRef?.current?.stop();

    function onKeyDown(e) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "Tab" && dialogRef.current) {
        const focusable = getFocusable(dialogRef.current);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
      lenisRef?.current?.start();
    };
  }, [state, onClose, lenisRef]);

  if (!state) return null;

  return (
    <div className="lightbox">
      <div className="lightbox__backdrop" onClick={onClose} />
      <div
        className="lightbox__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lightboxCaption"
        ref={dialogRef}
      >
        <button
          type="button"
          className="lightbox__close"
          aria-label="Bild schließen"
          onClick={onClose}
          ref={closeBtnRef}
        >
          &times;
        </button>
        <img className="lightbox__img" src={state.src} alt={state.caption} />
        <p id="lightboxCaption" className="lightbox__caption">
          {state.caption}
        </p>
      </div>
    </div>
  );
}
