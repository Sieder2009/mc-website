import { useEffect, useState } from "react";

// Loads a Modrinth user's public projects client-side.
// https://api.modrinth.com/v2/user/<name>/projects
export function useModrinth(username) {
  const [status, setStatus] = useState("loading"); // loading | empty | error | done
  const [projects, setProjects] = useState([]);

  useEffect(() => {
    const name = (username || "").trim();
    if (!name) {
      setStatus("empty");
      return;
    }

    let cancelled = false;
    setStatus("loading");

    fetch(`https://api.modrinth.com/v2/user/${encodeURIComponent(name)}/projects`)
      .then((res) => {
        if (!res.ok) throw new Error(`Modrinth API antwortete mit ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setProjects(Array.isArray(data) ? data : []);
        setStatus(Array.isArray(data) && data.length > 0 ? "done" : "empty");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [username]);

  return { status, projects };
}
