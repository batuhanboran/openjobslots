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
  sp.set("sort_by", params.sort ?? "posted_date");
  // Only constrain by region when the user explicitly chose one.
  if (params.region && params.region !== "all") {
    const f = resolveRegionFilter(params.region);
    if (f.regions) sp.set("regions", f.regions);
    if (f.countries) sp.set("countries", f.countries);
  }
  const res = await fetch(`/api/postings?${sp.toString()}`, { signal });
  if (!res.ok) throw new Error(`search_failed_${res.status}`);
  return (await res.json()) as SearchResponse;
}

/** "1000+" when the backend capped the count, else the exact number. */
export function formatCount(data: SearchResponse): string {
  const n = data.count ?? 0;
  if (data.count_capped || data.count_exact === false) return `${n.toLocaleString("tr-TR")}+`;
  return n.toLocaleString("tr-TR");
}
