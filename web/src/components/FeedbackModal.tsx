"use client";

import { useEffect, useState } from "react";
import { CloseIcon, ChatIcon } from "@/components/icons";
import { useI18n } from "@/components/LanguageProvider";

interface FeedbackModalProps {
  open: boolean;
  onClose: () => void;
}

const RATING_KEYS = ["feedback.r1", "feedback.r2", "feedback.r3", "feedback.r4"];

export function FeedbackModal({ open, onClose }: FeedbackModalProps) {
  const { t } = useI18n();
  const [rating, setRating] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      setRating(null);
      setComment("");
      setSending(false);
      setSent(false);
    }
  }, [open]);

  if (!open) return null;

  async function submit() {
    if (!rating || sending) return;
    setSending(true);
    try {
      await fetch("/frontend/log", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          level: "info",
          event: "public_feedback",
          message: comment.trim(),
          context: { rating, path: window.location.pathname },
        }),
      });
    } catch {
      // best-effort — still thank the user
    } finally {
      setSent(true);
      setSending(false);
    }
  }

  return (
    <div
      className="ojs-fade-in fixed inset-0 z-[6000] flex items-center justify-center px-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Geri bildirim paylaş"
        className="ojs-pop-in w-[min(460px,100%)] rounded-[24px] border p-6"
        style={{
          backgroundColor: "var(--ojs-panel-bg)",
          borderColor: "var(--ojs-panel-border)",
          boxShadow: "rgba(0,0,0,0.33) 0px 8px 10px -6px, rgba(0,0,0,0.33) 0px 25px 50px -12px",
        }}
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span style={{ color: "var(--ojs-accent-icon-fg)" }}>
              <ChatIcon className="h-5 w-5" />
            </span>
            <h2 className="text-[16px] font-semibold" style={{ color: "var(--ojs-page-fg)" }}>
              {t("qs.feedbackDesc")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("release.close")}
            className="shrink-0 rounded-full p-1 transition-colors hover:bg-[var(--ojs-iconbtn-hover)]"
            style={{ color: "var(--ojs-muted-fg)" }}
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        {sent ? (
          <div className="py-8 text-center">
            <p className="text-[15px] font-semibold" style={{ color: "var(--ojs-page-fg)" }}>
              {t("feedback.thanks")}
            </p>
            <p className="mt-1 text-[13px]" style={{ color: "var(--ojs-muted-fg)" }}>
              {t("feedback.thanksSub")}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-5 rounded-full px-5 py-2.5 text-[14px] font-semibold"
              style={{ backgroundColor: "var(--ojs-accent-solid-bg)", color: "var(--ojs-accent-solid-fg)" }}
            >
              {t("release.close")}
            </button>
          </div>
        ) : (
          <>
            <section
              className="rounded-[16px] p-4"
              style={{ backgroundColor: "var(--ojs-card-bg)" }}
            >
              <h3 className="mb-3 text-[13px] font-semibold" style={{ color: "var(--ojs-card-title)" }}>
                {t("feedback.question")}
              </h3>
              <div className="flex flex-col gap-2.5" role="radiogroup">
                {RATING_KEYS.map((key) => {
                  const active = rating === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setRating(key)}
                      className="flex items-center gap-2.5 text-left text-[14px]"
                      style={{ color: "var(--ojs-page-fg)" }}
                    >
                      <span
                        className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2"
                        style={{ borderColor: active ? "var(--ojs-accent)" : "var(--ojs-panel-border)" }}
                      >
                        {active && (
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: "var(--ojs-accent)" }}
                          />
                        )}
                      </span>
                      {t(key)}
                    </button>
                  );
                })}
              </div>
            </section>

            <section
              className="mt-4 rounded-[16px] p-4"
              style={{ backgroundColor: "var(--ojs-card-bg)" }}
            >
              <label
                htmlFor="ojs-feedback-comment"
                className="mb-2 block text-[13px] font-semibold"
                style={{ color: "var(--ojs-card-title)" }}
              >
                {t("feedback.commentLabel")}
              </label>
              <textarea
                id="ojs-feedback-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={4}
                className="w-full resize-none rounded-[10px] border bg-transparent p-3 text-[14px] outline-none"
                style={{ borderColor: "var(--ojs-panel-border)", color: "var(--ojs-page-fg)" }}
              />
            </section>

            <button
              type="button"
              onClick={submit}
              disabled={!rating || sending}
              className="mt-5 w-full rounded-full py-3 text-[14px] font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                backgroundColor: "var(--ojs-accent-solid-bg)",
                color: "var(--ojs-accent-solid-fg)",
              }}
            >
              {sending ? t("feedback.sending") : t("feedback.send")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
