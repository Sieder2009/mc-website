export default function Gallery({ builds, onOpen }) {
  return (
    <div className="gallery">
      {builds.map((build, i) => {
        if (!build.image) {
          return (
            <article className="gallery__card gallery__card--empty" key={i}>
              <div className="gallery__media">Bild folgt</div>
              <div className="gallery__body">
                <h4>{build.title || "Bauwerk folgt"}</h4>
              </div>
            </article>
          );
        }

        const caption = build.alt || build.title || "Bauwerk-Bild";
        return (
          <article className="gallery__card" key={i}>
            <button
              type="button"
              className="gallery__media"
              onClick={() => onOpen(build.image, caption)}
            >
              <img src={build.image} alt={caption} loading="lazy" decoding="async" />
            </button>
            <div className="gallery__body">
              <h4>{build.title || "Bauwerk folgt"}</h4>
              {build.description && <p>{build.description}</p>}
              {build.coordinates && <span className="gallery__coords">{build.coordinates}</span>}
            </div>
          </article>
        );
      })}
    </div>
  );
}
