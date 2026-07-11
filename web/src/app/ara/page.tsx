import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";
import { SearchBar } from "@/components/SearchBar";
import { ResultsView } from "@/components/ResultsView";

export default async function AraPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; region?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const region = sp.region ?? "all";

  return (
    <div className="flex min-h-screen flex-col">
      <header
        className="sticky top-0 z-10 flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:gap-5 sm:px-6"
        style={{
          backgroundColor: "var(--ojs-page-bg)",
          borderColor: "var(--ojs-footer-border)",
        }}
      >
        <Link href="/" className="shrink-0" aria-label="Ana sayfa">
          <Wordmark size={22} />
        </Link>
        <div className="w-full sm:max-w-[560px]">
          <SearchBar initialQuery={q} region={region} />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[720px] flex-1 px-4 py-6">
        <ResultsView query={q} region={region} />
      </main>
    </div>
  );
}
