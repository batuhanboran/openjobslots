"use client";

import { useCallback, useEffect, useState } from "react";
import { Wordmark } from "@/components/Wordmark";
import { SearchBar } from "@/components/SearchBar";
import { QuickSettings } from "@/components/QuickSettings";
import { SiteFooter } from "@/components/SiteFooter";
import { ReleaseNotesModal } from "@/components/ReleaseNotesModal";
import { FeedbackModal } from "@/components/FeedbackModal";
import { BackgroundDecoration } from "@/components/BackgroundDecoration";
import { LanguageProvider } from "@/components/LanguageProvider";
import { APP_VERSION, type ThemeMode } from "@/lib/site";

function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode === "system") {
    return typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return mode;
}

function applyTheme(mode: ThemeMode) {
  document.documentElement.classList.toggle("theme-light", resolveTheme(mode) === "light");
}

export function HomeClient() {
  const [theme, setThemeState] = useState<ThemeMode>("dark");
  const [region, setRegionState] = useState("all");
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [seenVersion, setSeenVersion] = useState("");

  // Hydrate persisted preferences after mount.
  useEffect(() => {
    const t = (localStorage.getItem("ojs-theme") as ThemeMode | null) ?? "dark";
    setThemeState(t);
    setRegionState(localStorage.getItem("ojs-region") ?? "all");
    setSeenVersion(localStorage.getItem("ojs-release-seen") ?? "");
    applyTheme(t);
  }, []);

  // Keep "system" in sync with OS changes.
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const setTheme = useCallback((t: ThemeMode) => {
    setThemeState(t);
    localStorage.setItem("ojs-theme", t);
    applyTheme(t);
  }, []);

  const setRegion = useCallback((v: string) => {
    setRegionState(v);
    localStorage.setItem("ojs-region", v);
  }, []);

  const openReleaseNotes = useCallback(() => {
    setReleaseOpen(true);
    setSeenVersion(APP_VERSION);
    localStorage.setItem("ojs-release-seen", APP_VERSION);
  }, []);

  return (
    <LanguageProvider>
      <div className="relative flex min-h-screen flex-col">
        <BackgroundDecoration />

        <QuickSettings
          theme={theme}
          onThemeChange={setTheme}
          region={region}
          onRegionChange={setRegion}
          onOpenFeedback={() => setFeedbackOpen(true)}
        />

        <main className="relative z-[1] flex flex-1 flex-col items-center justify-center px-4 pb-24">
          <Wordmark className="mb-8" size={46} />
          <SearchBar region={region} />
        </main>

        <SiteFooter
          onOpenReleaseNotes={openReleaseNotes}
          hasUnseenRelease={seenVersion !== APP_VERSION}
        />

        <ReleaseNotesModal open={releaseOpen} onClose={() => setReleaseOpen(false)} />
        <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
      </div>
    </LanguageProvider>
  );
}
