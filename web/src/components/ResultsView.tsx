"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  fetchPostings,
  formatCount,
  type IntentFilters,
  type PostingItem,
  type SearchResponse,
} from "@/lib/api";
import { JobCard } from "@/components/JobCard";
import { useI18n } from "@/components/LanguageProvider";

interface ResultsViewProps {
  query: string;
  region: string;
  filters?: IntentFilters;
}

export function ResultsView({ query, region, filters = {} }: ResultsViewProps) {
  const { t } = useI18n();
  const router = useRouter();
  const [items, setItems] = useState<PostingItem[]>([]);
  const [meta, setMeta] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [error, setError] = useState(false);
  const offsetRef = useRef(0);
  // Bumped whenever the search params change; a late load-more response from
  // an older generation must not append into the new result list.
  const genRef = useRef(0);

  const { remote, freshness_days, ats } = filters;

  useEffect(() => {
    // A filter-only search (e.g. landing on /ara?remote=remote) is valid too.
    if (!query && !remote && !freshness_days && !ats) {
      setLoading(false);
      setItems([]);
      setMeta(null);
      return;
    }
    const ctrl = new AbortController();
    genRef.current += 1;
    setLoading(true);
    setError(false);
    setLoadMoreError(false);
    offsetRef.current = 0;
    fetchPostings({ q: query, region, remote, freshness_days, ats, offset: 0 }, ctrl.signal)
      .then((data) => {
        if (data.error) {
          setError(true);
          setItems([]);
          setMeta(null);
          return;
        }
        setItems(data.items ?? []);
        setMeta(data);
        offsetRef.current = data.items?.length ?? 0;
      })
      .catch((e: unknown) => {
        if (!(e instanceof DOMException && e.name === "AbortError")) setError(true);
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [query, region, remote, freshness_days, ats]);

  const loadMore = useCallback(() => {
    const gen = genRef.current;
    setLoadingMore(true);
    setLoadMoreError(false);
    fetchPostings({ q: query, region, remote, freshness_days, ats, offset: offsetRef.current })
      .then((data) => {
        if (gen !== genRef.current) return;
        setItems((prev) => [...prev, ...(data.items ?? [])]);
        setMeta(data);
        offsetRef.current += data.items?.length ?? 0;
      })
      .catch(() => {
        if (gen === genRef.current) setLoadMoreError(true);
      })
      .finally(() => setLoadingMore(false));
  }, [query, region, remote, freshness_days, ats]);

  // Active intent-filter pills: label + ✕ to remove that filter from the URL.
  const activeFilters: { key: keyof IntentFilters; label: string }[] = [];
  if (remote === "remote") activeFilters.push({ key: "remote", label: t("filter.remote") });
  if (remote === "hybrid") activeFilters.push({ key: "remote", label: t("filter.hybrid") });
  if (remote === "non_remote") activeFilters.push({ key: "remote", label: t("filter.onsite") });
  if (freshness_days) {
    activeFilters.push({
      key: "freshness_days",
      label: t("filter.lastDays").replace("{n}", String(freshness_days)),
    });
  }
  if (ats) activeFilters.push({ key: "ats", label: ats });

  function removeFilter(key: keyof IntentFilters) {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (region && region !== "all") params.set("region", region);
    if (key !== "remote" && remote) params.set("remote", remote);
    if (key !== "freshness_days" && freshness_days)
      params.set("freshness_days", String(freshness_days));
    if (key !== "ats" && ats) params.set("ats", ats);
    router.push(`/ara?${params.toString()}`);
  }

  const filterPills = activeFilters.length > 0 && (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {activeFilters.map((f) => (
        <button
          key={f.key}
          type="button"
          onClick={() => removeFilter(f.key)}
          aria-label={`${f.label} — ${t("filter.remove")}`}
          title={t("filter.remove")}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium transition-opacity hover:opacity-80"
          style={{
            backgroundColor: "var(--ojs-accent-pill-bg)",
            color: "var(--ojs-accent-pill-fg)",
          }}
        >
          {f.label}
          <span aria-hidden>×</span>
        </button>
      ))}
    </div>
  );

  if (!query && activeFilters.length === 0) {
    return (
      <p className="py-16 text-center text-[14px]" style={{ color: "var(--ojs-muted-fg)" }}>
        {t("results.startHint")}
      </p>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        <div className="h-4 w-40 animate-pulse rounded" style={{ backgroundColor: "var(--ojs-card-bg)" }} />
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-[92px] animate-pulse rounded-[16px] border"
            style={{ backgroundColor: "var(--ojs-card-bg)", borderColor: "var(--ojs-panel-border)" }}
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-16 text-center">
        <p className="text-[15px] font-semibold" style={{ color: "var(--ojs-page-fg)" }}>
          {t("results.errorTitle")}
        </p>
        <p className="mt-1 text-[13px]" style={{ color: "var(--ojs-muted-fg)" }}>
          {t("results.errorSub")}
        </p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div>
        {filterPills}
        <p className="py-16 text-center text-[14px]" style={{ color: "var(--ojs-muted-fg)" }}>
          <span style={{ color: "var(--ojs-page-fg)" }}>“{query}”</span> {t("results.emptyPrefix")}
        </p>
      </div>
    );
  }

  return (
    <div>
      {filterPills}
      <p className="mb-4 text-[13px]" style={{ color: "var(--ojs-muted-fg)" }}>
        <span className="font-semibold" style={{ color: "var(--ojs-page-fg)" }}>
          {meta ? formatCount(meta) : items.length}
        </span>{" "}
        {t("results.count")}
        {query ? <> · “{query}”</> : null}
      </p>

      <div className="flex flex-col gap-3">
        {items.map((item) => (
          <JobCard key={`${item.id}-${item.job_posting_url}`} item={item} />
        ))}
      </div>

      {meta?.has_more && (
        <div className="mt-6 flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="rounded-full px-5 py-2.5 text-[13px] font-semibold transition-opacity disabled:opacity-60"
            style={{
              backgroundColor: "var(--ojs-accent-pill-bg)",
              color: "var(--ojs-accent-pill-fg)",
            }}
          >
            {loadingMore ? t("results.loading") : t("results.loadMore")}
          </button>
          {loadMoreError && (
            <p className="text-[12px]" style={{ color: "var(--ojs-muted-fg)" }}>
              {t("results.retry")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
