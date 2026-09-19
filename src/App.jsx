import { useEffect } from "react";
import { content } from "./data/content.js";
import Header from "./components/Header.jsx";
import Hero from "./components/Hero.jsx";
import WorldSection from "./components/WorldSection.jsx";
import StatsSection from "./components/StatsSection.jsx";
import ModrinthSection from "./components/ModrinthSection.jsx";
import ServerSection from "./components/ServerSection.jsx";
import ContactSection from "./components/ContactSection.jsx";
import Footer from "./components/Footer.jsx";
import SectionDots from "./components/SectionDots.jsx";
import Lightbox from "./components/Lightbox.jsx";
import { useLightbox } from "./hooks/useLightbox.js";

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
    <>
      <a className="skip-link" href="#main">
        Zum Inhalt springen
      </a>

      <Header name={content.name} serverAddress={serverAddress} />
      <SectionDots items={dotItems} />

      <main id="main">
        <Hero content={content} />

        <WorldSection
          world={content.world}
          worldHistory={content.worldHistory}
          builds={content.builds}
          level={weltLevel}
          onOpenLightbox={lightbox.open}
        />

        <StatsSection stats={content.stats} level={statistikLevel} />

        <ModrinthSection username={content.modrinthUsername} level={modrinthLevel} />

        {serverAddress && <ServerSection address={serverAddress} level={serverLevel} />}

        <ContactSection contact={content.contact} level={kontaktLevel} />
      </main>

      <Footer links={content.links} name={content.name} />

      <Lightbox state={lightbox.state} onClose={lightbox.close} />
    </>
  );
}
