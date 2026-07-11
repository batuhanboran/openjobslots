"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchPostings,
  formatCount,
  type PostingItem,
  type SearchResponse,
} from "@/lib/api";
import { JobCard } from "@/components/JobCard";

interface ResultsViewProps {
  query: string;
  region: string;
}

export function ResultsView({ query, region }: ResultsViewProps) {
  const [items, setItems] = useState<PostingItem[]>([]);
  const [meta, setMeta] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const offsetRef = useRef(0);

  useEffect(() => {
    if (!query) {
      setLoading(false);
      setItems([]);
      setMeta(null);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setError(false);
    offsetRef.current = 0;
    fetchPostings({ q: query, region, offset: 0 }, ctrl.signal)
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
  }, [query, region]);

  const loadMore = useCallback(() => {
    setLoadingMore(true);
    fetchPostings({ q: query, region, offset: offsetRef.current })
      .then((data) => {
        setItems((prev) => [...prev, ...(data.items ?? [])]);
        setMeta(data);
        offsetRef.current += data.items?.length ?? 0;
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  }, [query, region]);

  if (!query) {
    return (
      <p className="py-16 text-center text-[14px]" style={{ color: "var(--ojs-muted-fg)" }}>
        Aramaya başlamak için bir anahtar kelime girin.
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
          Arama şu an kullanılamıyor
        </p>
        <p className="mt-1 text-[13px]" style={{ color: "var(--ojs-muted-fg)" }}>
          Sunucuya ulaşılamadı. Lütfen birazdan tekrar deneyin.
        </p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <p className="py-16 text-center text-[14px]" style={{ color: "var(--ojs-muted-fg)" }}>
        <span style={{ color: "var(--ojs-page-fg)" }}>“{query}”</span> için sonuç bulunamadı.
      </p>
    );
  }

  return (
    <div>
      <p className="mb-4 text-[13px]" style={{ color: "var(--ojs-muted-fg)" }}>
        <span className="font-semibold" style={{ color: "var(--ojs-page-fg)" }}>
          {meta ? formatCount(meta) : items.length}
        </span>{" "}
        sonuç · “{query}”
      </p>

      <div className="flex flex-col gap-3">
        {items.map((item) => (
          <JobCard key={`${item.id}-${item.job_posting_url}`} item={item} />
        ))}
      </div>

      {meta?.has_more && (
        <div className="mt-6 flex justify-center">
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
            {loadingMore ? "Yükleniyor…" : "Daha fazla yükle"}
          </button>
        </div>
      )}
    </div>
  );
}
