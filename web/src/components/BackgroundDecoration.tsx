/** Subtle topographic curves echoing Brave's homepage backdrop. Very faint. */
export function BackgroundDecoration() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ zIndex: 0 }}
    >
      <svg
        className="absolute right-[-10%] top-[-8%] h-[130%] w-[80%]"
        viewBox="0 0 800 800"
        fill="none"
        preserveAspectRatio="xMidYMid slice"
        style={{ opacity: 0.5 }}
      >
        {Array.from({ length: 9 }).map((_, i) => (
          <path
            key={i}
            d={`M-40 ${120 + i * 78} C 220 ${40 + i * 78}, 520 ${260 + i * 78}, 860 ${140 + i * 78}`}
            stroke="var(--ojs-panel-border)"
            strokeWidth="1"
            fill="none"
            opacity={0.5 - i * 0.03}
          />
        ))}
      </svg>
    </div>
  );
}
