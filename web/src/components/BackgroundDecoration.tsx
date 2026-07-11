/** Subtle topographic curves echoing Brave's homepage backdrop. Very faint.
 * Full-bleed with a fixed aspect mapping so the strokes stay smooth curves on
 * every viewport (a cropped `slice` mapping previously magnified them into
 * stray diagonal streaks on tall/narrow screens). */
export function BackgroundDecoration() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ zIndex: 0 }}
    >
      <svg
        className="h-full w-full"
        viewBox="0 0 1440 900"
        fill="none"
        preserveAspectRatio="none"
        style={{ opacity: 0.4 }}
      >
        {Array.from({ length: 12 }).map((_, i) => (
          <path
            key={i}
            d={`M-60 ${90 + i * 72} C 360 ${20 + i * 72}, 700 ${170 + i * 72}, 1080 ${70 + i * 72} S 1520 ${140 + i * 72}, 1520 ${100 + i * 72}`}
            stroke="var(--ojs-panel-border)"
            strokeWidth="1"
            fill="none"
            opacity={0.45 - i * 0.025}
          />
        ))}
      </svg>
    </div>
  );
}
