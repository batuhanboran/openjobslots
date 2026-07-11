import { WORDMARK_SEGMENTS } from "@/lib/site";
import { cn } from "@/lib/utils";

interface WordmarkProps {
  className?: string;
  /** font-size in px for the wordmark text */
  size?: number;
}

/** OpenJobSlots wordmark — three purple tones, mirrors the production brand. */
export function Wordmark({ className, size = 44 }: WordmarkProps) {
  return (
    <span
      className={cn("inline-flex select-none items-baseline font-bold tracking-tight", className)}
      style={{ fontSize: size, lineHeight: 1 }}
      aria-label="openjobslots"
    >
      {WORDMARK_SEGMENTS.map((seg) => (
        <span key={seg.text} style={{ color: `var(${seg.varName})` }}>
          {seg.text}
        </span>
      ))}
    </span>
  );
}
