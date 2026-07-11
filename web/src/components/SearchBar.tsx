"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SearchIcon, MicIcon } from "@/components/icons";
import { useI18n } from "@/components/LanguageProvider";
import { fetchSuggestions, type SuggestionItem } from "@/lib/api";
import type { Lang } from "@/lib/i18n";

interface SearchBarProps {
  initialQuery?: string;
  /** Region value from quick-settings; only applied when not "all". */
  region?: string;
}

// Minimal typing for the browser SpeechRecognition API (not in lib.dom).
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechResultEvent = {
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
};

function createRecognition(): SpeechRecognitionLike | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

// Dictation locale follows the active UI language.
const SPEECH_LOCALES: Record<Lang, string> = {
  tr: "tr-TR", en: "en-US", de: "de-DE", fr: "fr-FR", es: "es-ES", pt: "pt-BR",
  it: "it-IT", nl: "nl-NL", pl: "pl-PL", ja: "ja-JP", ko: "ko-KR", zh: "zh-CN",
};

// Legacy App.js parity: 700ms debounce, 5-minute per-session cache, >= 2 chars.
const SUGGEST_DEBOUNCE_MS = 700;
const SUGGEST_CACHE_TTL_MS = 5 * 60 * 1000;
const SUGGEST_MIN_CHARS = 2;

// Right-aligned type hint per suggestion type (i18n key).
const SUGGESTION_TYPE_KEYS: Record<string, string> = {
  title: "suggestion.title",
  company: "suggestion.company",
  location: "suggestion.location",
  source: "suggestion.ats",
  intent: "suggestion.filter",
  shortcut: "suggestion.search",
};

// Client-side intent detection (legacy App.js parity — the postgres suggest
// endpoint returns only DB rows, so remote/hybrid/onsite/freshness intents
// are derived from the query text here).
function buildIntentSuggestions(
  q: string,
  t: (k: string) => string,
): SuggestionItem[] {
  const lq = q.toLowerCase();
  const hasWord = (w: string) =>
    new RegExp(`(^|\\s)${w}(\\s|$)`).test(lq) || (w.length >= 4 && lq.includes(w));
  const out: SuggestionItem[] = [];
  if (hasWord("remote") || hasWord("wfh") || lq.includes("work from home")) {
    out.push({
      type: "intent", value: "remote", label: t("filter.remote"), count: 1,
      intent_type: "remote", filter: { remote: "remote" },
    });
  }
  if (hasWord("hybrid")) {
    out.push({
      type: "intent", value: "hybrid", label: t("filter.hybrid"), count: 1,
      intent_type: "hybrid", filter: { remote: "hybrid" },
    });
  }
  if (hasWord("onsite") || lq.includes("on site") || lq.includes("in office")) {
    out.push({
      type: "intent", value: "onsite", label: t("filter.onsite"), count: 1,
      intent_type: "onsite", filter: { remote: "non_remote" },
    });
  }
  // Only explicit temporal phrases — a bare "3d" token is a job query
  // ("3d artist"), not a freshness intent.
  if (/(^|\s)(last|past|within)\s+3\s*(days?|d)(\s|$)/.test(lq)) {
    out.push({
      type: "intent", value: "3", label: t("filter.lastDays").replace("{n}", "3"), count: 1,
      intent_type: "freshness", filter: { freshness_days: 3 },
    });
  }
  return out;
}

/** Prepend detected intents, dedupe by type:value, cap the panel size. */
function mergeSuggestions(
  intents: SuggestionItem[],
  fetched: SuggestionItem[],
): SuggestionItem[] {
  const seen = new Set<string>();
  const out: SuggestionItem[] = [];
  for (const it of [...intents, ...fetched]) {
    const key = `${(it.type || "").toLowerCase()}:${it.value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
    if (out.length >= 8) break;
  }
  return out;
}

export function SearchBar({ initialQuery = "", region }: SearchBarProps) {
  const { t, lang } = useI18n();
  const [query, setQuery] = useState(initialQuery);
  const [micState, setMicState] = useState<"idle" | "listening" | "unsupported">("idle");
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const cacheRef = useRef(new Map<string, { items: SuggestionItem[]; at: number }>());
  // After submit/select, don't reopen the panel for the same text until edited.
  const suppressedRef = useRef<string | null>(initialQuery.trim() || null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const router = useRouter();

  useEffect(() => {
    return () => recognitionRef.current?.stop();
  }, []);

  // Synchronous suggestion handling lives in the change handler (close/clear,
  // serve fresh cache); the effect below only runs the debounced fetch.
  function handleQueryChange(value: string) {
    setQuery(value);
    const q = value.trim();
    if (q.length < SUGGEST_MIN_CHARS || q === suppressedRef.current) {
      setSuggestions([]);
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    const cached = cacheRef.current.get(`${lang}:${q.toLowerCase()}`);
    if (cached && Date.now() - cached.at < SUGGEST_CACHE_TTL_MS) {
      const merged = mergeSuggestions(buildIntentSuggestions(q, t), cached.items);
      setSuggestions(merged);
      setOpen(merged.length > 0);
      setActiveIndex(-1);
    }
  }

  // Debounced fetch for queries without a fresh cache entry.
  useEffect(() => {
    const q = query.trim();
    if (q.length < SUGGEST_MIN_CHARS || q === suppressedRef.current) return;
    const key = `${lang}:${q.toLowerCase()}`;
    const cached = cacheRef.current.get(key);
    if (cached && Date.now() - cached.at < SUGGEST_CACHE_TTL_MS) return;
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      // Re-check at both async boundaries (legacy App.js parity): submit or
      // suggestion-select may have suppressed this text while we waited, and
      // a blurred input must not get a panel popped over unrelated content.
      if (q === suppressedRef.current) return;
      fetchSuggestions(q, lang, ctrl.signal)
        .then((items) => {
          cacheRef.current.set(key, { items, at: Date.now() });
          if (q === suppressedRef.current) return;
          if (document.activeElement !== inputRef.current) return;
          const merged = mergeSuggestions(buildIntentSuggestions(q, t), items);
          setSuggestions(merged);
          setOpen(merged.length > 0);
          setActiveIndex(-1);
        })
        .catch(() => {});
    }, SUGGEST_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [query, lang, t]);

  function baseParams(q: string): URLSearchParams {
    const r =
      region ??
      (typeof window !== "undefined" ? localStorage.getItem("ojs-region") : null) ??
      "all";
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (r && r !== "all") params.set("region", r);
    return params;
  }

  function closePanel() {
    setOpen(false);
    setActiveIndex(-1);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    suppressedRef.current = q;
    closePanel();
    router.push(`/ara?${baseParams(q).toString()}`);
  }

  function selectSuggestion(s: SuggestionItem) {
    const q = query.trim();
    if (s.filter && (s.filter.remote || s.filter.freshness_days || s.filter.ats)) {
      // Intent/source suggestion: keep the query text, apply the filter.
      suppressedRef.current = q;
      closePanel();
      const params = baseParams(q);
      if (s.filter.remote) params.set("remote", s.filter.remote);
      if (s.filter.freshness_days) params.set("freshness_days", String(s.filter.freshness_days));
      if (s.filter.ats) params.set("ats", s.filter.ats);
      router.push(`/ara?${params.toString()}`);
      return;
    }
    // Plain suggestion: search for its value.
    setQuery(s.value);
    suppressedRef.current = s.value.trim();
    closePanel();
    router.push(`/ara?${baseParams(s.value.trim()).toString()}`);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (suggestions.length === 0) return;
      setOpen(true);
      setActiveIndex((prev) => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      if (open && activeIndex >= 0 && activeIndex < suggestions.length) {
        e.preventDefault();
        selectSuggestion(suggestions[activeIndex]);
      }
    } else if (e.key === "Escape") {
      closePanel();
    }
  }

  function toggleMic() {
    if (micState === "listening") {
      recognitionRef.current?.stop();
      return;
    }
    const rec = createRecognition();
    if (!rec) {
      setMicState("unsupported");
      window.setTimeout(() => setMicState("idle"), 3000);
      return;
    }
    rec.lang = SPEECH_LOCALES[lang] ?? "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      setQuery(text);
    };
    rec.onend = () => setMicState("idle");
    rec.onerror = () => setMicState("idle");
    recognitionRef.current = rec;
    setMicState("listening");
    rec.start();
  }

  const listening = micState === "listening";
  const panelOpen = open && suggestions.length > 0;

  return (
    <form
      onSubmit={handleSubmit}
      role="search"
      className="ojs-search-form relative flex h-[58px] w-full max-w-[692px] items-center gap-1 rounded-[30px] pl-2 pr-2 transition-shadow duration-150"
      style={{
        backgroundColor: "var(--ojs-search-bg)",
        // Plain-CSS safety net: keep geometry sane even if the Tailwind
        // utility chunk is missing/late (stale-HTML-after-deploy scenario).
        maxWidth: 692,
        borderRadius: panelOpen ? "22px 22px 0 0" : 30,
      }}
    >
      <span
        className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full"
        style={{ color: "var(--ojs-search-placeholder)" }}
        aria-hidden
      >
        <SearchIcon className="h-[19px] w-[19px]" />
      </span>

      <input
        ref={inputRef}
        type="text"
        name="q"
        value={query}
        onChange={(e) => handleQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={closePanel}
        placeholder={listening ? t("search.listening") : t("search.placeholder")}
        aria-label={t("search.placeholder")}
        role="combobox"
        aria-expanded={panelOpen}
        aria-controls="ojs-suggest-panel"
        aria-autocomplete="list"
        autoComplete="off"
        className="ojs-search-input min-w-0 flex-1 border-0 bg-transparent text-[16px] outline-none"
        style={{ color: "var(--ojs-search-fg)" }}
      />

      <button
        type="button"
        onClick={toggleMic}
        aria-label={listening ? t("search.micStop") : t("search.micStart")}
        aria-pressed={listening}
        className="relative flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[var(--ojs-iconbtn-hover)]"
        style={{ color: listening ? "#ef4444" : "var(--ojs-search-placeholder)" }}
      >
        {listening && (
          <span
            className="ojs-pulse-ring absolute inset-1 rounded-full"
            style={{ backgroundColor: "#ef4444" }}
          />
        )}
        <MicIcon className="relative h-[19px] w-[19px]" />
      </button>

      <button
        type="submit"
        className="flex h-[36px] shrink-0 items-center rounded-full px-4 text-[13px] font-semibold transition-transform active:scale-[0.97]"
        style={{ backgroundColor: "var(--ojs-accent)", color: "#ffffff" }}
      >
        {t("search.button")}
      </button>

      {panelOpen && (
        <div
          id="ojs-suggest-panel"
          className="absolute left-0 right-0 top-full z-20 overflow-hidden rounded-b-[22px] pb-2"
          style={{
            backgroundColor: "var(--ojs-search-bg)",
            boxShadow: "0 14px 28px -8px rgba(0,0,0,0.35)",
          }}
          role="listbox"
        >
          <div className="mx-4 border-t" style={{ borderColor: "var(--ojs-panel-border)" }} />
          {suggestions.map((s, i) => (
            <button
              key={`${s.type}:${s.value}:${i}`}
              type="button"
              role="option"
              aria-selected={i === activeIndex}
              // mousedown fires before the input's blur closes the panel
              onMouseDown={(e) => {
                e.preventDefault();
                selectSuggestion(s);
              }}
              onMouseEnter={() => setActiveIndex(i)}
              className="flex w-full items-center gap-3 px-4 py-2 text-left"
              style={{
                backgroundColor: i === activeIndex ? "var(--ojs-iconbtn-hover)" : "transparent",
              }}
            >
              <SearchIcon
                className="h-4 w-4 shrink-0"
                style={{ color: "var(--ojs-search-placeholder)" }}
              />
              <span
                className="min-w-0 flex-1 truncate text-[14px]"
                style={{ color: "var(--ojs-search-fg)" }}
              >
                {s.label || s.value}
              </span>
              <span
                className="shrink-0 text-[11px]"
                style={{ color: "var(--ojs-muted-fg)" }}
              >
                {t(SUGGESTION_TYPE_KEYS[(s.type || "").toLowerCase()] ?? "suggestion.search")}
              </span>
            </button>
          ))}
        </div>
      )}

      {micState === "unsupported" && (
        <div
          className="absolute left-1/2 top-[64px] -translate-x-1/2 rounded-lg px-3 py-1.5 text-[12px]"
          style={{ backgroundColor: "var(--ojs-card-bg)", color: "var(--ojs-muted-fg)" }}
        >
          {t("search.micUnsupported")}
        </div>
      )}

      <style>{`
        .ojs-search-form:focus-within { box-shadow: 0 0 0 1px var(--ojs-accent), 0 6px 22px -6px rgba(124,58,237,0.35); }
        .ojs-search-input::placeholder { color: var(--ojs-search-placeholder); }
      `}</style>
    </form>
  );
}
