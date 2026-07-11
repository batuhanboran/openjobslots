import type { PostingItem } from "@/lib/api";
import { MapPinIcon, ArrowRightIcon } from "@/components/icons";

const TR_MONTHS = [
  "Oca", "Şub", "Mar", "Nis", "May", "Haz",
  "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara",
];

function fmt(d: Date): string {
  return `${d.getUTCDate()} ${TR_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// Sources return dates in several shapes: ISO, epoch (s/ms), or a relative
// English label. Normalize them so cards never show a raw epoch number.
function formatDate(raw: string | null): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${Number(iso[3])} ${TR_MONTHS[Number(iso[2]) - 1]} ${iso[1]}`;
  if (/^\d{9,10}$/.test(s)) return fmt(new Date(Number(s) * 1000));
  if (/^\d{12,13}$/.test(s)) return fmt(new Date(Number(s)));
  if (/posted today|^today$/i.test(s)) return "Bugün";
  if (/posted yesterday|^yesterday$/i.test(s)) return "Dün";
  // Only surface short textual labels; hide anything else odd.
  return /[a-zçğıöşü]/i.test(s) && s.length <= 24 ? s : null;
}

export function JobCard({ item }: { item: PostingItem }) {
  const date = formatDate(item.posting_date);
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
            {item.position_name || "İsimsiz ilan"}
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
