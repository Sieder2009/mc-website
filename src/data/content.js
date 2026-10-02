// ============================================================================
// INHALT DER SEITE — hier trägst du deine echten Daten und Bilder ein.
// Alles, was du hier änderst, erscheint automatisch auf der Seite.
// Felder mit null / [] / "" sind noch leer und werden auf der Seite
// automatisch sauber ausgeblendet oder durch einen Platzhalter ersetzt.
// ============================================================================

export const content = {
  // --- Allgemein -----------------------------------------------------------
  name: "affenmal",
  slogan: "Meine Minecraft-Welt, meine Bauwerke, meine Projekte.",

  links: {
    github: "https://github.com/Sieder2009",
    modrinth: "https://modrinth.com/user/Sieder",
  },

  // --- Hero-Hintergrund ------------------------------------------------------
  // Optional: Datei nach public/assets/screenshots/ legen und Pfad hier
  // eintragen, z. B. "assets/screenshots/hero.webp" oder "assets/screenshots/hero.mp4".
  // Ohne Angabe wird automatisch die Block-Deko gezeigt.
  hero: {
    image: null,
    video: null,

    // Kurze Zeilen links/rechts vom Skin im Hero-Bereich. Wörter in
    // GROSSBUCHSTABEN werden automatisch farbig hervorgehoben. Leer lassen,
    // um eine Zeile auszublenden.
    leftLabel: "Meine Welt (日本)",
    leftText: "Japanische Tempel, Gärten und eine eigene Geschichte — Block für Block gebaut.",
    rightText: "Manche Bauwerke dauern WOCHEN. Manche nur STUNDEN.",
  },

  // --- Minecraft-Profil ------------------------------------------------------
  // Trage hier deinen Minecraft-Namen ein, sobald du ihn zur Hand hast.
  // Ohne Namen zeigt der Viewer automatisch den Standard-Skin (Steve).
  minecraftName: "affenmal",

  // --- Meine Welt --------------------------------------------------------
  world: {
    name: "", // z. B. "Neuland" — Name der Welt
    version: "1.21.11",
    modloader: "Fabric",
    gamemode: "Survival",
    createdDate: "23.09.2023", // TT.MM.JJJJ
    // Kurzer Text zur Entstehung/Geschichte der Welt.
    description:
      "Erstellt am 23.09.2023 — eine meiner liebsten Welten, an der ich seitdem weiterbaue.",

    // Download-Link für die Welt-Datei (.zip der Welt). Welt-Dateien sind meist
    // zu groß für GitHub Pages — lade sie z. B. auf Google Drive, MediaFire oder
    // als GitHub-Release hoch und trage hier den Link ein.
    // Leer/null lassen, um den Download-Button auszublenden.
    downloadUrl: null,
    downloadSize: "", // optional, z. B. "1.4 GB" — wird neben dem Button angezeigt
  },

  // Zeitleiste der Weltgeschichte. Ein Eintrag pro Meilenstein.
  // Die Daten der Farmen sind geschätzt (nur die Reihenfolge ist sicher) —
  // fest steht nur die Creaking-Farm am 13.08.2026. Gerne korrigieren!
  worldHistory: [
    {
      date: "23.09.2023",
      title: "Weltstart",
      text: "Die Welt wurde im Survival-Modus erstellt — heute läuft sie auf Fabric 1.21.11.",
    },
    {
      date: "14.10.2023",
      title: "Kleine Eisenfarm",
      text: "Die erste Farm der Welt: eine kleine Eisengolem-Farm, die für den Anfang Eisen liefert.",
    },
    {
      date: "02.12.2023",
      title: "Villager-Breeder",
      text: "Nachschub an Dorfbewohnern — die Grundlage für Handel und die nächsten Farmen.",
    },
    {
      date: "20.01.2024",
      title: "Creeper-Farm",
      text: "Schwarzpulver für Raketen und TNT.",
    },
    {
      date: "09.03.2024",
      title: "Zuckerrohrfarm",
      text: "Zuckerrohr für Papier — für Raketen, Bücher und den Handel mit Dorfbewohnern.",
    },
    {
      date: "27.04.2024",
      title: "Wollfarm",
      text: "Automatisch geschorene Schafe liefern Wolle zum Bauen und Dekorieren.",
    },
    {
      date: "22.06.2024",
      title: "Slimefarm",
      text: "Schleimbälle für Schleimblöcke, klebrige Kolben und Leinen.",
    },
    {
      date: "07.09.2024",
      title: "Große Eisenfarm",
      text: "Der große Nachfolger der ersten Eisenfarm — deutlich mehr Eisen pro Stunde.",
    },
    {
      date: "30.11.2024",
      title: "Bambusfarm",
      text: "Bambus für Gerüste, Brennstoff und Bambusholz — passt perfekt zum japanischen Stil der Welt.",
    },
    {
      date: "15.03.2025",
      title: "Enderman-Farm",
      text: "Enderperlen und jede Menge Erfahrungspunkte.",
    },
    {
      date: "11.10.2025",
      title: "Hexenfarm",
      text: "Hexen-Drops wie Redstone, Glowstone, Zucker und Glasflaschen.",
    },
    {
      date: "13.08.2026",
      title: "Creaking-Farm",
      text: "Die neueste Farm: Ein Creaking aus dem Blassen Garten liefert Harz — für Harzziegel und Deko.",
    },
    // Weitere Einträge einfach als { date, title, text } ergänzen.
  ],

  // Wichtigste Bauwerke. Bild-Datei nach public/assets/screenshots/ legen und
  // den Dateinamen unten eintragen. Ohne Bild wird eine Platzhalter-Karte gezeigt.
  // Titel/Beschreibungen sind aus den Screenshots geraten — gerne anpassen!
  builds: [
    {
      title: "Museumshalle",
      description: "Große Ausstellungshalle mit gemustertem Boden und Vitrinen für gesammelte Items.",
      coordinates: "X: -178, Y: 15, Z: -257",
      image: "assets/screenshots/museum-halle.webp",
      alt: "Museumshalle mit gemustertem Boden und goldenen Vitrinen",
    },
    {
      title: "Roter Schrein",
      description: "Japanisch inspirierter Schrein mit rot-weißem Dach, direkt neben einer dunklen Steinstruktur.",
      coordinates: "X: -149, Y: 86, Z: -278",
      image: "assets/screenshots/roter-schrein.webp",
      alt: "Japanischer Schrein mit rot-weiß gestreiftem Dach",
    },
    {
      title: "Übersicht: Yin-Yang-Landart",
      description: "Riesiges Yin-Yang-Symbol in die Landschaft geformt, mit mehreren Bauwerken rundherum.",
      coordinates: "",
      image: "assets/screenshots/uebersicht-yin-yang.webp",
      alt: "Luftaufnahme eines riesigen Yin-Yang-Symbols in der Landschaft",
    },
    {
      title: "Gefecht an der Tori-Brücke",
      description: "Ein Raid-Kampf an einer Brücke mit auffälliger roter, flügelartiger Konstruktion.",
      coordinates: "X: -129, Y: 94, Z: 266",
      image: "assets/screenshots/tori-gefecht.webp",
      alt: "Kampf an einer Brücke mit roter, flügelartiger Struktur",
    },
    {
      title: "Nether-Stützpunkt",
      description: "Basis in den Basalt-Deltas mit Vitrinen für seltene Nether-Materialien.",
      coordinates: "X: -99, Y: 128, Z: -183",
      image: "assets/screenshots/nether-stuetzpunkt.webp",
      alt: "Stützpunkt im Nether mit Materialvitrinen",
    },
    {
      title: "Galerie-Gang",
      description: "Heller Korridor mit Laternen und großformatigen Bildern an den Wänden.",
      coordinates: "X: -180, Y: 12, Z: -318",
      image: "assets/screenshots/galerie-gang.webp",
      alt: "Heller Ausstellungs-Korridor mit gerahmten Bildern",
    },
    {
      title: "Dorf in der Abenddämmerung",
      description: "Terrassierte Siedlung mit mehreren Häusern und Kirschblütenbäumen.",
      coordinates: "X: -247, Y: 76, Z: -251",
      image: "assets/screenshots/dorf-abenddaemmerung.webp",
      alt: "Dorf mit Kirschblüten in der Abenddämmerung",
    },
    {
      title: "Elytra-Flug in die Ferne",
      description: "Ausflug weit hinaus in unerforschtes Gebiet — Berge, Wälder und Flüsse so weit das Auge reicht.",
      coordinates: "X: 16346, Y: 123, Z: 3721",
      image: "assets/screenshots/elytra-flug.webp",
      alt: "Elytra-Flug über eine weite, unberührte Landschaft",
    },
  ],

  // --- Statistiken -----------------------------------------------------------
  // value: null => Feld zeigt "–" statt einer erfundenen Zahl.
  // Spieltage direkt aus dem F3-Debug-Screen abgelesen.
  stats: [
    { label: "Spieltage", value: 1000, suffix: "" },
    { label: "Bauwerke", value: 8, suffix: "" },
    { label: "Weltgröße", value: null, suffix: " Blöcke" },
  ],

  // --- Modrinth ---------------------------------------------------------------
  // Öffentlicher Modrinth-Benutzername — Projekte werden live über die
  // Modrinth-API geladen (https://api.modrinth.com/v2/user/<name>/projects).
  modrinthUsername: "Sieder",

  // --- Server (optional) -------------------------------------------------------
  // Adresse eintragen, um den Server-Bereich anzuzeigen. Leer lassen zum Ausblenden.
  serverAddress: "",

  // --- Kontakt -----------------------------------------------------------------
  // type: "text" zeigt den Wert als reinen Text (z. B. Discord-Tag).
  // type: "email" baut die Adresse erst im Browser per JavaScript zusammen,
  // damit sie nicht im Klartext im HTML steht (Spam-Schutz).
  contact: {
    label: "Discord",
    value: "tommy_2134",
    type: "text",
  },
};
