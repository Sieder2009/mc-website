export default function Timeline({ entries }) {
  if (!entries || entries.length === 0) return null;
  return (
    <ol className="timeline">
      {entries.map((entry, i) => (
        <li key={i}>
          <time>{entry.date}</time>
          <h4>{entry.title}</h4>
          <p>{entry.text}</p>
        </li>
      ))}
    </ol>
  );
}
