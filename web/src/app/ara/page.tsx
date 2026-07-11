import { ResultsHeader } from "@/components/ResultsHeader";
import { ResultsView } from "@/components/ResultsView";
import { LanguageProvider } from "@/components/LanguageProvider";
import { Wordmark } from "@/components/Wordmark";
import type { IntentFilters } from "@/lib/api";

export default async function AraPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    region?: string;
    remote?: string;
    freshness_days?: string;
    ats?: string;
  }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const region = sp.region ?? "all";
  const filters: IntentFilters = {};
  if (sp.remote && ["remote", "hybrid", "non_remote"].includes(sp.remote)) {
    filters.remote = sp.remote;
  }
  const fresh = Number(sp.freshness_days);
  if ([3, 7, 30].includes(fresh)) filters.freshness_days = fresh;
  if (sp.ats) filters.ats = sp.ats;

  return (
    <LanguageProvider>
      <div className="flex min-h-screen flex-col">
        <ResultsHeader query={q} region={region} filters={filters} />
        {/* Brave-style: the results column left-aligns with the header search
            bar. The invisible wordmark mirrors the header's logo + gap so the
            offset tracks it exactly; below sm the header stacks and results
            stay centered. */}
        <div className="flex w-full flex-1 justify-center px-4 sm:justify-start sm:px-6">
          <div className="hidden shrink-0 sm:invisible sm:block" aria-hidden>
            <Wordmark size={22} />
          </div>
          <main className="w-full min-w-0 max-w-[688px] py-6 sm:ml-4">
            <ResultsView query={q} region={region} filters={filters} />
          </main>
        </div>
      </div>
    </LanguageProvider>
  );
}
