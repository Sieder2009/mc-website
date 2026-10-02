// mc-heads.net serves skins with CORS headers — needed both for the WebGL
// skin viewer and for reading the face pixels back out of a canvas (the
// animated tab icon). Same URL in both places, so the second load is cached.
export function skinUrlFor(minecraftName) {
  return `https://mc-heads.net/skin/${encodeURIComponent(minecraftName)}`;
}
