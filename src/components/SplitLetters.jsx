// Wraps each character of `text` in its own overflow-hidden mask so a
// GSAP tween can slide the letters up out of hiding. Renders as plain
// visible text with no JS/motion — the masks only clip, they don't hide.
// Letters are grouped per word (and per hyphenated part), and each group
// cannot break internally: a long heading wraps between words, never
// mid-word.
export default function SplitLetters({ text }) {
  const words = text.split(" ");
  return (
    <>
      {words.map((word, w) => (
        <span key={w}>
          {(word.match(/[^-]+-?|-+/g) || [word]).map((part, p) => (
            <span className="split-word" key={p}>
              {part.split("").map((char, i) => (
                <span className="split-letter-mask" key={i}>
                  <span className="split-letter">{char}</span>
                </span>
              ))}
            </span>
          ))}
          {w < words.length - 1 ? " " : null}
        </span>
      ))}
    </>
  );
}
