import { useEffect, useRef } from "react";
import SectionHeading from "./SectionHeading.jsx";
import { useModrinth } from "../hooks/useModrinth.js";
import { useReveal } from "../hooks/useReveal.js";
import { gsap, batchReveal, prefersReducedMotion } from "../lib/animation.js";

const STATUS_TEXT = {
  loading: "Lade Projekte …",
  error: "Projekte konnten nicht geladen werden.",
  empty: "Noch keine öffentlichen Projekte — sobald eins auf Modrinth freigegeben ist, erscheint es hier automatisch.",
  done: "",
};

const TYPE_LABEL = {
  mod: "Mod",
  modpack: "Modpack",
  resourcepack: "Ressourcenpaket",
  shader: "Shader",
  datapack: "Datenpaket",
  plugin: "Plugin",
};

export default function ModrinthSection({ username, level }) {
  const [ref, visible] = useReveal();
  const { status, projects, profile } = useModrinth(username);
  const gridRef = useRef(null);

  // The grid only mounts once the Modrinth API call resolves, so the
  // stagger has to (re-)run after that — not once at component mount.
  useEffect(() => {
    if (status !== "done" || prefersReducedMotion || !gridRef.current) return;
    const ctx = gsap.context(() => {
      batchReveal(".modrinth-card", { y: 28 }, { stagger: 0.07 });
    }, gridRef);
    return () => ctx.revert();
  }, [status, projects]);

  return (
    <section
      id="modrinth"
      ref={ref}
      className={`section reveal ${visible ? "is-visible" : ""}`}
      aria-labelledby="modrinth-h"
    >
      <div className="section__inner">
        <SectionHeading level={level} id="modrinth-h">
          Modrinth-Projekte
        </SectionHeading>
        {profile && (
          <a
            className="modrinth-profile"
            href={`https://modrinth.com/user/${encodeURIComponent(profile.username)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {profile.avatar_url && (
              <img className="modrinth-profile__avatar" src={profile.avatar_url} alt="" width="40" height="40" loading="lazy" />
            )}
            <span className="modrinth-profile__name">{profile.username}</span>
            <span className="modrinth-profile__link">Profil auf Modrinth ↗</span>
          </a>
        )}
        <p className="modrinth-status" role="status" aria-live="polite">
          {STATUS_TEXT[status]}
        </p>
        {status === "done" && (
          <div className="modrinth-grid" ref={gridRef}>
            {projects.map((project) => (
              <a
                key={project.id || project.slug}
                className="modrinth-card"
                href={`https://modrinth.com/${project.project_type}/${project.slug}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {project.icon_url && (
                  <img
                    className="modrinth-card__icon"
                    src={project.icon_url}
                    alt=""
                    loading="lazy"
                  />
                )}
                <div className="modrinth-card__body">
                  <h3>{project.title}</h3>
                  {project.description && (
                    <p className="modrinth-card__desc">{project.description}</p>
                  )}
                  <span className="modrinth-card__downloads">
                    {TYPE_LABEL[project.project_type] || project.project_type} ·{" "}
                    {(project.downloads ?? 0).toLocaleString("de-DE")} Downloads
                  </span>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
