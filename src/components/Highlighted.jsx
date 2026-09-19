// Renders `text`, wrapping any ALL-CAPS word (e.g. "WOCHEN") in a colored
// <strong> so short flavor lines can highlight a keyword without markup.
export default function Highlighted({ text }) {
  const tokens = text.split(/(\s+)/);
  return (
    <>
      {tokens.map((token, i) => {
        const bare = token.trim();
        if (bare.length >= 2 && /^[A-ZÄÖÜß]+[.,!?]?$/.test(bare)) {
          return (
            <strong className="accent-word" key={i}>
              {token}
            </strong>
          );
        }
        return token;
      })}
    </>
  );
}
