import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// GitHub Pages serves this repo from /docs on main (set once in
// Settings -> Pages -> Branch: main, Folder: /docs). `base: "./"` keeps
// every asset URL relative so it works at any path depth.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "docs",
    emptyOutDir: true,
  },
});
