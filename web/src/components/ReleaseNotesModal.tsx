"use client";

import { useEffect } from "react";
import { CloseIcon } from "@/components/icons";
import { RELEASE_NOTES } from "@/lib/releaseNotes";
import { useI18n } from "@/components/LanguageProvider";

interface ReleaseNotesModalProps {
  open: boolean;
  onClose: () => void;
}

// Fixed light palette mirrored from the production OpenJobSlots modal so the
// popup looks identical to the existing site regardless of the page theme.
const C = {
  overlay: "rgba(38, 51, 45, 0.36)",
  surface: "#ffffff",
  border: "#D7DDD2",
  softBorder: "#E2E7DE",
  surfaceMuted: "#E5EEE4",
  ink: "#26332D",
  text: "#33443C",
  muted: "#68756E",
};

export function ReleaseNotesModal({ open, onClose }: ReleaseNotesModalProps) {
  const { t } = useI18n();
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="ojs-fade-in fixed inset-0 z-[6000] flex items-center justify-center px-[18px]"
      style={{ backgroundColor: C.overlay }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("release.title")}
        className="ojs-pop-in relative flex max-h-[82vh] w-full max-w-[760px] flex-col rounded-[18px] border p-[22px]"
        style={{
          backgroundColor: C.surface,
          borderColor: C.border,
          boxShadow: "0 18px 30px rgba(38, 51, 45, 0.14)",
        }}
      >
        <div className="mb-[14px] flex items-start justify-between gap-4">
          <h2
            className="text-[28px] font-extrabold leading-[34px]"
            style={{ color: C.ink }}
          >
            {t("release.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("release.close")}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-[14px] py-2 text-[12px] font-bold transition-opacity hover:opacity-80"
            style={{
              backgroundColor: C.surfaceMuted,
              borderColor: C.border,
              color: C.text,
            }}
          >
            <CloseIcon className="h-3.5 w-3.5" strokeWidth={2.25} />
            {t("release.close")}
          </button>
        </div>

        <div
          className="ojs-scroll -mr-2 overflow-y-auto pr-2"
          aria-label={t("release.title")}
        >
          {RELEASE_NOTES.map((note) => (
            <article
              key={note.version}
              className="border-t py-4 first:border-t-0 first:pt-0"
              style={{ borderColor: C.softBorder }}
            >
              <div className="flex flex-wrap items-baseline gap-x-[10px] gap-y-1">
                <h3
                  className="text-[18px] font-extrabold leading-[24px]"
                  style={{ color: C.ink }}
                >
                  {t("release.version")} {note.version}
                </h3>
                <span className="text-[13px] leading-[18px]" style={{ color: C.muted }}>
                  {note.date}
                </span>
              </div>
              <p
                className="mt-2 text-[14px] font-bold leading-[20px]"
                style={{ color: C.text }}
              >
                {note.title}
              </p>
              <p
                className="mt-[5px] text-[14px] leading-[21px]"
                style={{ color: C.muted }}
              >
                {note.summary}
              </p>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
