"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Wordmark } from "@/components/Wordmark";
import { SearchBar } from "@/components/SearchBar";
import { ChevronDownIcon } from "@/components/icons";
import { REGION_OPTIONS } from "@/lib/site";
import { useI18n } from "@/components/LanguageProvider";
import type { IntentFilters } from "@/lib/api";

export function ResultsHeader({
  query,
  region,
  filters = {},
}: {
  query: string;
  region: string;
  filters?: IntentFilters;
}) {
  const { t } = useI18n();
  const router = useRouter();

  function onRegion(value: string) {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (value && value !== "all") params.set("region", value);
    if (filters.remote) params.set("remote", filters.remote);
    if (filters.freshness_days) params.set("freshness_days", String(filters.freshness_days));
    if (filters.ats) params.set("ats", filters.ats);
    router.push(`/ara?${params.toString()}`);
  }

  return (
    <header
      className="sticky top-0 z-10 flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-6"
      style={{
        backgroundColor: "var(--ojs-page-bg)",
        borderColor: "var(--ojs-footer-border)",
      }}
    >
      <Link href="/" className="shrink-0" aria-label={t("nav.home")}>
        <Wordmark size={22} />
      </Link>
      {/* flex-wrap lets the region select drop below the bar on narrow
          screens so the query input never gets squeezed unreadably. */}
      <div className="flex w-full flex-wrap items-center gap-2 sm:min-w-0 sm:max-w-[640px] sm:flex-nowrap">
        <div className="min-w-[280px] flex-1">
          <SearchBar initialQuery={query} region={region} />
        </div>
        <div className="relative inline-flex shrink-0 items-center">
          <select
            aria-label={t("qs.region")}
            className="ojs-select"
            value={region}
            onChange={(e) => onRegion(e.target.value)}
          >
            {REGION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {t(o.labelKey)}
              </option>
            ))}
          </select>
          <ChevronDownIcon
            className="pointer-events-none absolute right-3 h-4 w-4"
            style={{ color: "var(--ojs-accent-pill-fg)" }}
          />
        </div>
      </div>
    </header>
  );
}
