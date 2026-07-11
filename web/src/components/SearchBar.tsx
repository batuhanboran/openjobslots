"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SearchIcon, MicIcon } from "@/components/icons";

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

export function SearchBar({ initialQuery = "", region }: SearchBarProps) {
  const [query, setQuery] = useState(initialQuery);
  const [micState, setMicState] = useState<"idle" | "listening" | "unsupported">("idle");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const router = useRouter();

  useEffect(() => {
    return () => recognitionRef.current?.stop();
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    const r =
      region ??
      (typeof window !== "undefined" ? localStorage.getItem("ojs-region") : null) ??
      "all";
    const params = new URLSearchParams({ q });
    if (r && r !== "all") params.set("region", r);
    router.push(`/ara?${params.toString()}`);
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
    rec.lang = "tr-TR";
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

  return (
    <form
      onSubmit={handleSubmit}
      role="search"
      className="ojs-search-form relative flex h-[58px] w-full max-w-[692px] items-center gap-1 rounded-[30px] pl-2 pr-2 transition-shadow duration-150"
      style={{ backgroundColor: "var(--ojs-search-bg)" }}
    >
      <span
        className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full"
        style={{ color: "var(--ojs-search-placeholder)" }}
        aria-hidden
      >
        <SearchIcon className="h-[19px] w-[19px]" />
      </span>

      <input
        type="text"
        name="q"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={listening ? "Dinleniyor… konuşun" : "Açık iş ilanlarını ara…"}
        aria-label="Açık iş ilanlarını ara"
        autoComplete="off"
        className="ojs-search-input min-w-0 flex-1 border-0 bg-transparent text-[16px] outline-none"
        style={{ color: "var(--ojs-search-fg)" }}
      />

      <button
        type="button"
        onClick={toggleMic}
        aria-label={listening ? "Ses girişini durdur" : "Ses girişini başlat"}
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
        Ara
      </button>

      {micState === "unsupported" && (
        <div
          className="absolute left-1/2 top-[64px] -translate-x-1/2 rounded-lg px-3 py-1.5 text-[12px]"
          style={{ backgroundColor: "var(--ojs-card-bg)", color: "var(--ojs-muted-fg)" }}
        >
          Tarayıcınız sesli aramayı desteklemiyor
        </div>
      )}

      <style>{`
        .ojs-search-form:focus-within { box-shadow: 0 0 0 1px var(--ojs-accent), 0 6px 22px -6px rgba(124,58,237,0.35); }
        .ojs-search-input::placeholder { color: var(--ojs-search-placeholder); }
      `}</style>
    </form>
  );
}
