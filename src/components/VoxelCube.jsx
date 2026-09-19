// A tiny CSS-only isometric cube (3 skewed faces) used as floating decor.
// `color` sets the top-face hue; the side faces are auto-darkened via CSS.
export default function VoxelCube({ color = "var(--c-grass)", size = 40, className = "" }) {
  const style = { "--cube-size": `${size}px`, "--cube-color": color };
  return (
    <span className={`voxel-cube ${className}`} style={style} aria-hidden="true">
      <span className="voxel-cube__top" />
      <span className="voxel-cube__left" />
      <span className="voxel-cube__right" />
    </span>
  );
}
