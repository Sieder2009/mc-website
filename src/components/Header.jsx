import { useState } from "react";

const NAV_ITEMS = [
  { href: "#top", label: "Profil" },
  { href: "#welt", label: "Welt" },
  { href: "#statistik", label: "Statistik" },
  { href: "#modrinth", label: "Modrinth" },
  { href: "#kontakt", label: "Kontakt" },
];

export default function Header({ name, serverAddress }) {
  const [open, setOpen] = useState(false);

  const items = serverAddress
    ? [...NAV_ITEMS.slice(0, 4), { href: "#server", label: "Server" }, NAV_ITEMS[4]]
    : NAV_ITEMS;

  return (
    <header className="site-header">
      <nav className="nav" aria-label="Hauptnavigation">
        <a className="nav__brand" href="#top">
          {name}
        </a>
        <button
          className="nav__toggle"
          type="button"
          aria-expanded={open}
          aria-controls="navMenu"
          onClick={() => setOpen((o) => !o)}
        >
          <span className="sr-only">Menü öffnen</span>
          <span className="nav__toggle-bar" aria-hidden="true" />
        </button>
        <ul className={`nav__menu ${open ? "is-open" : ""}`} id="navMenu">
          {items.map((item) => (
            <li key={item.href}>
              <a href={item.href} onClick={() => setOpen(false)}>
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
