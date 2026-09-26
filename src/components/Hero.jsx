import { useEffect, useRef } from "react";
import Highlighted from "./Highlighted.jsx";
import SkinViewer from "./SkinViewer.jsx";
import MagneticLink from "./MagneticLink.jsx";
import { gsap, ScrollTrigger, EASE, prefersReducedMotion } from "../lib/animation.js";

export default function Hero({ content }) {
  const { name, slogan, hero, links, minecraftName } = content;
  const showVideo = hero.video && !prefersReducedMotion;
  const showImage = !showVideo && hero.image;
  const showKanji = !showVideo && !showImage;
  const sectionRef = useRef(null);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section || prefersReducedMotion) return;

    let removeIntroListener = () => {};

    const ctx = gsap.context(() => {
      const letters = section.querySelectorAll(".hero__letter");
      gsap.set(letters, { yPercent: 110 });

      // Built paused so it can't play out silently underneath the intro
      // loader — released together once that finishes (or immediately
      // below, if it already had by the time this effect ran).
      const revealTl = gsap
        .timeline({ paused: true, defaults: { ease: EASE.out } })
        .to(letters, { yPercent: 0, duration: 0.9, stagger: 0.035 })
        .fromTo(
          ".hero__title-dot",
          { scale: 0 },
          { scale: 1, duration: 0.4, ease: "back.out(3)" },
          "-=0.35"
        )
        .from(".hero__reveal", { autoAlpha: 0, y: 18, duration: 0.7, stagger: 0.08 }, "-=0.5");

      const CUE_SHAFT = 16;
      gsap.set(".hero__cue-shaft", { strokeDasharray: CUE_SHAFT, strokeDashoffset: CUE_SHAFT });
      gsap.set(".hero__cue-head", { opacity: 0, y: -4 });
      const cueTl = gsap
        .timeline({ paused: true, repeat: -1, repeatDelay: 0.4 })
        .to(".hero__cue-shaft", { strokeDashoffset: 0, duration: 0.5, ease: "power2.out" })
        .to(".hero__cue-head", { opacity: 1, y: 0, duration: 0.28, ease: "power2.out" }, "-=0.2")
        .to(".hero__cue", { y: 6, opacity: 0, duration: 0.35, ease: "power2.in" }, "+=0.5")
        .set(".hero__cue-shaft", { strokeDashoffset: CUE_SHAFT })
        .set(".hero__cue-head", { opacity: 0, y: -4 })
        .set(".hero__cue", { y: 0, opacity: 1 });

      function playIntroTimelines() {
        gsap.delayedCall(0.15, () => revealTl.play());
        gsap.delayedCall(1.2, () => cueTl.play());
      }

      if (document.documentElement.dataset.introDone === "true") {
        playIntroTimelines();
      } else {
        window.addEventListener("introdone", playIntroTimelines, { once: true });
        removeIntroListener = () => window.removeEventListener("introdone", playIntroTimelines);
      }

      // gone within the first half screen of scrolling, before the camera reaches the gate
      gsap.to(".hero__content", {
        autoAlpha: 0,
        yPercent: -8,
        ease: "none",
        scrollTrigger: { trigger: section, start: "top top", end: () => "+=" + window.innerHeight * 0.5, scrub: 0.6 },
      });
    }, section);

    return () => {
      removeIntroListener();
      ctx.revert();
    };
  }, []);

  useEffect(() => {
    ScrollTrigger.refresh();
  }, []);

  return (
    <section id="top" className="hero" ref={sectionRef}>
      <div className="hero__bg" aria-hidden="true">
        {showVideo && (
          <video className="hero__media" src={hero.video} autoPlay muted loop playsInline />
        )}
        {showImage && <img className="hero__media" src={hero.image} alt="" loading="eager" />}
        {showKanji && (
          <div className="hero__decor">
            <span className="hero__kanji">日本</span>
          </div>
        )}
        <span className="hero__corner hero__corner--tl" />
        <span className="hero__corner hero__corner--br" />
      </div>

      <div className="hero__content">
        <p className="hero__eyebrow badge hero__reveal">Minecraft-Portfolio</p>

        <h1 className="hero__title">
          <span className="hero__title-text">
            {name.split("").map((char, i) => (
              <span className="hero__letter-mask" key={i}>
                <span className="hero__letter">{char}</span>
              </span>
            ))}
            <span className="hero__title-dot" aria-hidden="true" />
          </span>
        </h1>

        <p className="hero__slogan hero__reveal">{slogan}</p>

        <div className="hero__showcase hero__reveal">
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

        <div className="hero__actions hero__reveal">
          <MagneticLink className="btn btn--primary" href="#welt">
            Welt entdecken
          </MagneticLink>
          {links.modrinth && (
            <MagneticLink
              className="btn btn--secondary"
              href={links.modrinth}
              target="_blank"
              rel="noopener"
            >
              Modrinth
            </MagneticLink>
          )}
          {links.github && (
            <MagneticLink
              className="btn btn--secondary"
              href={links.github}
              target="_blank"
              rel="noopener"
            >
              GitHub
            </MagneticLink>
          )}
        </div>
      </div>

      {!prefersReducedMotion && (
        <p className="hero__cue" aria-hidden="true">
          <svg className="hero__cue-arrow" viewBox="0 0 14 22" width="14" height="22" fill="none">
            <line
              className="hero__cue-shaft"
              x1="7"
              y1="1"
              x2="7"
              y2="17"
              stroke="currentColor"
              strokeWidth="2"
            />
            <path
              className="hero__cue-head"
              d="M2 13 L7 18 L12 13"
              stroke="currentColor"
              strokeWidth="2"
              fill="none"
            />
          </svg>
          <span>Scrollen</span>
        </p>
      )}
    </section>
  );
}
