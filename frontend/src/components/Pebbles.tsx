export function Pebbles({ count, size = "sm" }: { count: number; size?: "sm" | "md" }) {
  const found = Math.max(0, Math.min(3, count));
  return (
    <span className={`pebbles ${size}`} aria-label={`${found} of 3 Otter Pebbles`}>
      {[0, 1, 2].map((index) => (
        <span key={index} className={index < found ? "on" : "off"} aria-hidden />
      ))}
    </span>
  );
}
