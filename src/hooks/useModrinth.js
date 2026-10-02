import { useEffect, useState } from "react";

function getJson(url) {
  return fetch(url).then((res) => {
    if (!res.ok) throw new Error(`Modrinth API antwortete mit ${res.status}`);
    return res.json();
  });
}

// Loads a Modrinth user's public profile and projects client-side, on every
// visit — a newly approved project shows up without touching the site.
// https://api.modrinth.com/v2/user/<name>  and  .../<name>/projects
export function useModrinth(username) {
  const [status, setStatus] = useState("loading"); // loading | empty | error | done
  const [projects, setProjects] = useState([]);
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    const name = (username || "").trim();
    if (!name) {
      setStatus("empty");
      return;
    }

    let cancelled = false;
    setStatus("loading");
    const base = `https://api.modrinth.com/v2/user/${encodeURIComponent(name)}`;

    // Only the avatar and name are used — the section works without them.
    getJson(base)
      .then((user) => {
        if (!cancelled) setProfile(user);
      })
      .catch(() => {});

    getJson(`${base}/projects`)
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data) ? [...data].sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0)) : [];
        setProjects(list);
        setStatus(list.length > 0 ? "done" : "empty");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [username]);

  return { status, projects, profile };
}
