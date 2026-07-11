import type { PostingItem } from "@/lib/api";
import { MapPinIcon, ArrowRightIcon } from "@/components/icons";
import { useI18n } from "@/components/LanguageProvider";
import type { Lang } from "@/lib/i18n";

// Normalize the many date shapes (ISO / epoch s|ms / relative label) and
// localize the absolute ones to the active UI language.
function formatDate(
  raw: string | null,
  lang: Lang,
  t: (k: string) => string,
): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", year: "numeric" }).format(d);

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return fmt(new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3])));
  if (/^\d{9,10}$/.test(s)) return fmt(new Date(Number(s) * 1000));
  if (/^\d{12,13}$/.test(s)) return fmt(new Date(Number(s)));
  if (/posted today|^today$/i.test(s)) return t("date.today");
  if (/posted yesterday|^yesterday$/i.test(s)) return t("date.yesterday");
  // Relative backend labels like "Posted 6 Days Ago" / "2 weeks ago" —
  // localize instead of passing raw English through.
  const rel = /(?:posted\s+)?(\d+)\+?\s+(day|week|month)s?\s+ago/i.exec(s);
  if (rel) {
    const unit = rel[2].toLowerCase() as "day" | "week" | "month";
    return new Intl.RelativeTimeFormat(lang, { numeric: "auto" }).format(-Number(rel[1]), unit);
  }
  return /[a-zçğıöşü]/i.test(s) && s.length <= 24 ? s : null;
}

export function JobCard({ item }: { item: PostingItem }) {
  const { t, lang } = useI18n();
  const date = formatDate(item.posting_date, lang, t);
  return (
    <a
      href={item.job_posting_url}
      target="_blank"
      rel="noopener noreferrer"
      className="ojs-jobcard group block rounded-[16px] border p-4 transition-colors"
      style={{
        backgroundColor: "var(--ojs-card-bg)",
        borderColor: "var(--ojs-panel-border)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3
            className="truncate text-[15px] font-semibold"
            style={{ color: "var(--ojs-card-title)" }}
          >
            {item.position_name || t("job.untitled")}
          </h3>
          <p className="mt-0.5 text-[13px]" style={{ color: "var(--ojs-accent-icon-fg)" }}>
            {item.company_name || "—"}
          </p>
        </div>
        <ArrowRightIcon
          className="mt-1 h-4 w-4 shrink-0 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100"
          style={{ color: "var(--ojs-accent-icon-fg)" }}
        />
      </div>

      <div
        className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]"
        style={{ color: "var(--ojs-muted-fg)" }}
      >
        {item.location && (
          <span className="inline-flex items-center gap-1">
            <MapPinIcon className="h-3.5 w-3.5" />
            <span className="max-w-[280px] truncate">{item.location}</span>
          </span>
        )}
        {date && <span>{date}</span>}
        {item.ats && (
          <span
            className="rounded-full px-2 py-[1px] text-[11px] font-medium"
            style={{
              backgroundColor: "var(--ojs-accent-pill-bg)",
              color: "var(--ojs-accent-pill-fg)",
            }}
          >
            {item.ats}
          </span>
        )}
      </div>

      <style>{`.ojs-jobcard:hover { border-color: var(--ojs-accent) !important; }`}</style>
    </a>
  );
}
