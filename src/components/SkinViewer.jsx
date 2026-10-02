import { useEffect, useRef, useState } from "react";
import { SkinViewer as SkinView3D } from "skinview3d";
import { skinUrlFor } from "../lib/skin.js";

const DEFAULT_SKIN_URL = skinUrlFor("MHF_Steve");

export default function SkinViewer({ minecraftName }) {
  const canvasRef = useRef(null);
  const viewerRef = useRef(null);
  const [status, setStatus] = useState("Lade Skin …");
  const [ariaLabel, setAriaLabel] = useState("3D-Vorschau des Minecraft-Skins");
  const [rotating, setRotating] = useState(true);
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // No skin up front: skinview3d applies whichever image finishes loading
    // last, so a default Steve loading next to the real skin could land on
    // top of it. Steve is only fetched when there is no name or it fails.
    let viewer;
    try {
      viewer = new SkinView3D({
        canvas,
        width: 340,
        height: 460,
      });
    } catch {
      setAvailable(false);
      setStatus("3D-Vorschau konnte nicht geladen werden.");
      setAriaLabel("3D-Vorschau des Minecraft-Skins nicht verfügbar");
      return;
    }

    // Turning the model with the mouse stays; zooming is off — and with it,
    // the mouse wheel over the skin scrolls the page instead of being eaten.
    viewer.controls.enableZoom = false;

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    viewer.autoRotateSpeed = 0.6;
    viewerRef.current = viewer;

    function syncRotateState(autoRotate) {
      viewer.autoRotate = autoRotate;
      setRotating(autoRotate);
    }
    syncRotateState(!motionQuery.matches);
    const onMotionChange = (e) => syncRotateState(!e.matches);
    motionQuery.addEventListener("change", onMotionChange);

    const name = (minecraftName || "").trim();
    if (!name) {
      setStatus("Standard-Skin wird gezeigt — mein Minecraft-Name folgt.");
      setAriaLabel("Standard-Minecraft-Skin (Platzhalter)");
      viewer.loadSkin(DEFAULT_SKIN_URL).catch(() => {});
    } else {
      setStatus(`Lade Skin von ${name} …`);
      setAriaLabel(`Lade Skin von ${name}`);
      viewer
        .loadSkin(skinUrlFor(name))
        .then(() => {
          setStatus(`Skin von ${name}`);
          setAriaLabel(`Drehbares 3D-Modell des Minecraft-Skins von ${name}`);
        })
        .catch(() => {
          setStatus(`Skin von "${name}" konnte nicht geladen werden — Standard-Skin wird gezeigt.`);
          setAriaLabel("Standard-Minecraft-Skin (Platzhalter)");
          viewer.loadSkin(DEFAULT_SKIN_URL).catch(() => {});
        });
    }

    return () => {
      motionQuery.removeEventListener("change", onMotionChange);
      viewer.dispose();
    };
  }, [minecraftName]);

  function toggleRotate() {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.autoRotate = !viewer.autoRotate;
    setRotating(viewer.autoRotate);
  }

  return (
    <div className="skin-panel skin-panel--hero">
      <div className="skin-panel__viewer">
        <canvas
          ref={canvasRef}
          id="skinCanvas"
          width={340}
          height={460}
          role="img"
          aria-label={ariaLabel}
        />
      </div>
      <div className="skin-panel__side">
        <p className="skin-status" role="status" aria-live="polite">
          {status}
        </p>
        {available && (
          <div className="skin-panel__controls">
            <button
              type="button"
              className="btn btn--small"
              aria-pressed={rotating}
              onClick={toggleRotate}
            >
              {rotating ? "Drehung pausieren" : "Drehung fortsetzen"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
