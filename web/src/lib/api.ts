// Client-side helper that talks to our own Next.js proxy route (/api/postings),
// which forwards to the OpenJobSlots backend. Keeps the API origin server-side
// so there is no CORS coupling and the deploy target stays flexible.

import { resolveRegionFilter } from "@/lib/site";

export interface PostingItem {
  id: number;
  company_name: string;
  position_name: string;
  job_posting_url: string;
  location: string | null;
  posting_date: string | null;
  last_seen_epoch: number | null;
  ats: string | null;
}

export interface SearchResponse {
  items: PostingItem[];
  count: number;
  count_exact?: boolean;
  count_capped?: boolean;
  has_more?: boolean;
  next_offset?: number;
  error?: string;
}

export interface SearchParams {
  q: string;
  region?: string;
  sort?: string;
  limit?: number;
  offset?: number;
  /** Intent filters applied from search suggestions (legacy App.js parity). */
  remote?: string; // remote | hybrid | non_remote
  freshness_days?: number; // 3 | 7 | 30
  ats?: string;
}

/** Filters portion of SearchParams, as parsed from /ara URL params. */
export interface IntentFilters {
  remote?: string;
  freshness_days?: number;
  ats?: string;
}

export interface SuggestionItem {
  type: string; // title | company | location | intent | source | shortcut | …
  value: string;
  label: string;
  count: number;
  intent_type?: string;
  filter?: IntentFilters;
}

export interface SuggestResponse {
  ok?: boolean;
  items: SuggestionItem[];
  count: number;
  error?: string;
}

export const PAGE_SIZE = 25;

export async function fetchPostings(
  params: SearchParams,
  signal?: AbortSignal,
): Promise<SearchResponse> {
  const sp = new URLSearchParams();
  sp.set("search", params.q);
  sp.set("limit", String(params.limit ?? PAGE_SIZE));
  sp.set("offset", String(params.offset ?? 0));
  // Relevance-first so exact title matches rank at the top (backend supports it).
  sp.set("sort_by", params.sort ?? "relevance");
  // Only constrain by region when the user explicitly chose one.
  if (params.region && params.region !== "all") {
    const f = resolveRegionFilter(params.region);
    if (f.regions) sp.set("regions", f.regions);
    if (f.countries) sp.set("countries", f.countries);
  }
  // Intent filters (suggestion clicks) map 1:1 onto backend params.
  if (params.remote) sp.set("remote", params.remote);
  if (params.freshness_days) sp.set("freshness_days", String(params.freshness_days));
  if (params.ats) sp.set("ats", params.ats);
  const res = await fetch(`/api/postings?${sp.toString()}`, { signal });
  if (!res.ok) throw new Error(`search_failed_${res.status}`);
  return (await res.json()) as SearchResponse;
}

/** Search-as-you-type suggestions via our /api/suggest proxy. */
export async function fetchSuggestions(
  q: string,
  lang: string,
  signal?: AbortSignal,
): Promise<SuggestionItem[]> {
  const sp = new URLSearchParams({ search: q, limit: "8", page_language: lang });
  const res = await fetch(`/api/suggest?${sp.toString()}`, { signal });
  if (!res.ok) return [];
  const data = (await res.json()) as SuggestResponse;
  // Drop plain "search" echo items (legacy parity) and server-side "intent"
  // items: SearchBar derives intents client-side with localized labels, and
  // the server's freshness regex false-positives on queries like "3d artist".
  return (data.items ?? []).filter((it) => {
    const type = (it.type || "").toLowerCase();
    return type !== "search" && type !== "intent";
  });
}

/** "1000+" when the backend capped the count, else the exact number. */
export function formatCount(data: SearchResponse): string {
  const n = data.count ?? 0;
  if (data.count_capped || data.count_exact === false) return `${n.toLocaleString("tr-TR")}+`;
  return n.toLocaleString("tr-TR");
}
