import { useEffect } from "react";
import { content } from "./data/content.js";
import Hero from "./components/Hero.jsx";
import WorldSection from "./components/WorldSection.jsx";
import StatsSection from "./components/StatsSection.jsx";
import ModrinthSection from "./components/ModrinthSection.jsx";
import ServerSection from "./components/ServerSection.jsx";
import ContactSection from "./components/ContactSection.jsx";
import Footer from "./components/Footer.jsx";
import SectionDots from "./components/SectionDots.jsx";
import Lightbox from "./components/Lightbox.jsx";
import SmoothScrollProvider from "./components/SmoothScrollProvider.jsx";
import ScrollProgressBar from "./components/ScrollProgressBar.jsx";
import CursorGlow from "./components/CursorGlow.jsx";
import IntroLoader from "./components/IntroLoader.jsx";
import WorldBackdrop from "./components/WorldBackdrop.jsx";
import { wantsWorld } from "./lib/world.js";
import { useLightbox } from "./hooks/useLightbox.js";

// An empty stretch of page: the content sheets part and the fixed 3D world
// (path, blossom trees, drifting petals) shows through unobstructed.
function SceneWindow({ size }) {
  if (!wantsWorld) return null;
  const cls = size === "end" ? "scene-window--tall scene-window--end" : size === "tall" ? "scene-window--tall" : "";
  return <div className={`scene-window ${cls}`} aria-hidden="true" />;
}

export default function App() {
  const lightbox = useLightbox();
  const serverAddress = (content.serverAddress || "").trim();

  useEffect(() => {
    document.documentElement.classList.add("js");
  }, []);

  let level = 0;
  const weltLevel = ++level;
  const statistikLevel = ++level;
  const modrinthLevel = ++level;
  const serverLevel = serverAddress ? ++level : null;
  const kontaktLevel = ++level;

  const dotItems = [
    { href: "#top", label: "Profil" },
    { href: "#welt", label: "Welt" },
    { href: "#statistik", label: "Statistik" },
    { href: "#modrinth", label: "Modrinth" },
    ...(serverAddress ? [{ href: "#server", label: "Server" }] : []),
    { href: "#kontakt", label: "Kontakt" },
  ];

  return (
    <SmoothScrollProvider>
      <a className="skip-link" href="#main">
        Zum Inhalt springen
      </a>

      <WorldBackdrop />
      <IntroLoader name={content.name} />
      <ScrollProgressBar />
      <CursorGlow />

      <SectionDots items={dotItems} />

      <main id="main">
        <Hero content={content} />

        <SceneWindow size="tall" />

        <WorldSection
          world={content.world}
          worldHistory={content.worldHistory}
          builds={content.builds}
          level={weltLevel}
          onOpenLightbox={lightbox.open}
        />

        <SceneWindow />

        <StatsSection stats={content.stats} level={statistikLevel} />

        <SceneWindow />

        <ModrinthSection username={content.modrinthUsername} level={modrinthLevel} />

        {serverAddress && (
          <>
            <SceneWindow />
            <ServerSection address={serverAddress} level={serverLevel} />
          </>
        )}

        <SceneWindow />

        <ContactSection contact={content.contact} level={kontaktLevel} />

        <SceneWindow size="end" />
      </main>

      <Footer links={content.links} name={content.name} />

      <Lightbox state={lightbox.state} onClose={lightbox.close} />
    </SmoothScrollProvider>
  );
}
