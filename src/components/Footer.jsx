export default function Footer({ links, name }) {
  const entries = [
    ["GitHub", links.github],
    ["Modrinth", links.modrinth],
  ].filter(([, href]) => Boolean(href));

  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div className="site-footer__links">
          {entries.map(([label, href]) => (
            <a key={label} href={href} target="_blank" rel="noopener noreferrer">
              {label}
            </a>
          ))}
        </div>
        <p className="site-footer__disclaimer">Nicht offiziell mit Mojang oder Microsoft verbunden.</p>
        <p className="site-footer__copy">&copy; {new Date().getFullYear()} {name}</p>
      </div>
    </footer>
  );
}
