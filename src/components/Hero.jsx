import { useMemo } from "react";
import Highlighted from "./Highlighted.jsx";
import SkinViewer from "./SkinViewer.jsx";
import VoxelCube from "./VoxelCube.jsx";

const prefersReducedMotion =
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function Hero({ content }) {
  const { name, slogan, hero, links, minecraftName } = content;
  const showVideo = hero.video && !prefersReducedMotion;
  const showImage = !showVideo && hero.image;
  const showCubes = !showVideo && !showImage;
  const cubes = useMemo(
    () => [
      { color: "var(--c-grass)", size: 54, className: "hero__cube--1" },
      { color: "var(--c-gold)", size: 38, className: "hero__cube--2" },
      { color: "var(--c-diamond)", size: 46, className: "hero__cube--3" },
      { color: "var(--c-redstone)", size: 30, className: "hero__cube--4" },
    ],
    []
  );

  return (
    <section id="top" className="hero">
      <div className="hero__bg" aria-hidden="true">
        {showVideo && (
          <video className="hero__media" src={hero.video} autoPlay muted loop playsInline />
        )}
        {showImage && <img className="hero__media" src={hero.image} alt="" loading="eager" />}
        {showCubes && (
          <div className="hero__decor">
            {cubes.map((cube) => (
              <VoxelCube
                key={cube.className}
                color={cube.color}
                size={cube.size}
                className={`hero__cube ${cube.className}`}
              />
            ))}
          </div>
        )}
      </div>

      <div className="hero__content">
        <p className="hero__eyebrow badge">Minecraft-Portfolio</p>

        <h1 className="hero__title">
          <span className="hero__title-text">{name}</span>
        </h1>

        <p className="hero__slogan">{slogan}</p>

        <div className="hero__showcase">
          {hero.leftText && (
            <div className="hero__flank hero__flank--left">
              {hero.leftLabel && <p className="hero__flank-label">{hero.leftLabel}</p>}
              <p className="hero__flank-text">
                <Highlighted text={hero.leftText} />
              </p>
            </div>
          )}

          <SkinViewer minecraftName={minecraftName} />

          {hero.rightText && (
            <div className="hero__flank hero__flank--right">
              <p className="hero__flank-text">
                <Highlighted text={hero.rightText} />
              </p>
            </div>
          )}
        </div>

        <div className="hero__actions">
          <a className="btn btn--primary" href="#welt">
            Welt entdecken
          </a>
          {links.modrinth && (
            <a className="btn btn--secondary" href={links.modrinth} target="_blank" rel="noopener">
              Modrinth
            </a>
          )}
          {links.github && (
            <a className="btn btn--secondary" href={links.github} target="_blank" rel="noopener">
              GitHub
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
