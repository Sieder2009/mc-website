// One-off helper used to curate and compress raw Minecraft screenshots into
// public/assets/screenshots/. Drop new raw files into SRC, add a job below,
// then `node scripts/process-screenshots.mjs` — resizes to max 1600px wide
// and converts to WebP so the gallery stays fast.
import sharp from "sharp";
import path from "node:path";
import fs from "node:fs";

const SRC = "screnshots";
const DEST = "public/assets/screenshots";

const jobs = [
  { src: "image (8).png", dest: "museum-halle.webp" },
  { src: "2026-09-18_18.05.04.jpg", dest: "roter-schrein.webp" },
  { src: "2026-09-18_18.06.19.jpg", dest: "uebersicht-yin-yang.webp" },
  { src: "image.png", dest: "tori-gefecht.webp" },
  { src: "image (2).png", dest: "nether-stuetzpunkt.webp" },
  { src: "image (5).png", dest: "galerie-gang.webp" },
  { src: "image (7).png", dest: "dorf-abenddaemmerung.webp" },
  { src: "image (16).png", dest: "elytra-flug.webp" },
];

fs.mkdirSync(DEST, { recursive: true });

for (const job of jobs) {
  const srcPath = path.join(SRC, job.src);
  const destPath = path.join(DEST, job.dest);
  await sharp(srcPath)
    .resize({ width: 1600, withoutEnlargement: true })
    .webp({ quality: 78 })
    .toFile(destPath);
  const { size } = fs.statSync(destPath);
  console.log(`${job.dest}: ${(size / 1024).toFixed(0)} KB`);
}
