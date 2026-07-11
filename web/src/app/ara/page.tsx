import { ResultsHeader } from "@/components/ResultsHeader";
import { ResultsView } from "@/components/ResultsView";
import { LanguageProvider } from "@/components/LanguageProvider";

export default async function AraPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; region?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const region = sp.region ?? "all";

  return (
    <LanguageProvider>
      <div className="flex min-h-screen flex-col">
        <ResultsHeader query={q} region={region} />
        <main className="mx-auto w-full max-w-[720px] flex-1 px-4 py-6">
          <ResultsView query={q} region={region} />
        </main>
      </div>
    </LanguageProvider>
  );
}
