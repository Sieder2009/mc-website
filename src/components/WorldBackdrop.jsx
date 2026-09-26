import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import CanvasBoundary from "./CanvasBoundary.jsx";
import { setWorldFailed, settleWorld, wantsWorld, worldLite } from "../lib/world.js";

// R3F and all the world assets are a separate, lazily loaded chunk: they never
// block first paint, and are only requested at all when motion is allowed and
// WebGL is available (three itself is shared with the skin viewer).
const WorldScene = lazy(() => import("./three/WorldScene.jsx"));

// One fixed WebGL canvas behind the whole page. While it is not drawing (still
// loading, WebGL lost, reduced motion) the page keeps its plain paper look;
// once it is, <html> gets .world-on and the content sheets turn translucent.
//
// A lost WebGL context (common on phones when the tab is backgrounded) drops
// back to plain paper; if the browser returns the context the scene is
// remounted from scratch (new key). A hard failure (the scene throws) or a GPU
// too slow to be worth it (the frame-rate governor gives up) is final.
export default function WorldBackdrop() {
  const [ready, setReady] = useState(false);
  const [lost, setLost] = useState(false);
  const [dead, setDead] = useState(false);
  const [generation, setGeneration] = useState(0);

  const onReady = useCallback(() => {
    setReady(true);
    settleWorld();
  }, []);
  const onLost = useCallback(() => {
    setLost(true);
    settleWorld();
  }, []);
  const onRestored = useCallback(() => {
    setReady(false);
    setLost(false);
    setGeneration((g) => g + 1);
  }, []);
  const onError = useCallback(() => {
    setDead(true);
    settleWorld();
  }, []);

  const active = ready && !lost && !dead;
  useEffect(() => {
    if (!active) return;
    document.documentElement.classList.add("world-on");
    return () => document.documentElement.classList.remove("world-on");
  }, [active]);

  const failed = lost || dead;
  useEffect(() => {
    if (!failed) return;
    setWorldFailed(true);
    return () => setWorldFailed(false);
  }, [failed]);

  if (!wantsWorld || dead) return null;

  return (
    <div className={`world ${active ? "is-ready" : ""}`} aria-hidden="true">
      <CanvasBoundary onError={onError}>
        <Suspense fallback={null}>
          <WorldScene key={generation} lite={worldLite} onReady={onReady} onLost={onLost} onRestored={onRestored} onGiveUp={onError} />
        </Suspense>
      </CanvasBoundary>
    </div>
  );
}
