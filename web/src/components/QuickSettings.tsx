"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  SettingsGearIcon,
  GlobeIcon,
  MapPinIcon,
  PaletteIcon,
  SunIcon,
  MoonIcon,
  MonitorIcon,
  ChevronDownIcon,
  ChatIcon,
} from "@/components/icons";
import { REGION_OPTIONS, type ThemeMode } from "@/lib/site";
import { SUPPORTED_LANGS, LANGUAGE_NAMES } from "@/lib/i18n";
import { useI18n } from "@/components/LanguageProvider";

interface QuickSettingsProps {
  theme: ThemeMode;
  onThemeChange: (t: ThemeMode) => void;
  region: string;
  onRegionChange: (v: string) => void;
  onOpenFeedback: () => void;
}

const THEME_BUTTONS: { value: ThemeMode; key: string; Icon: typeof SunIcon }[] = [
  { value: "light", key: "theme.light", Icon: SunIcon },
  { value: "dark", key: "theme.dark", Icon: MoonIcon },
  { value: "system", key: "theme.system", Icon: MonitorIcon },
];

export function QuickSettings({
  theme,
  onThemeChange,
  region,
  onRegionChange,
  onOpenFeedback,
}: QuickSettingsProps) {
  const { t, lang, setLang } = useI18n();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const languageOptions = SUPPORTED_LANGS.map((l) => ({ value: l, label: LANGUAGE_NAMES[l] }));
  const regionOptions = REGION_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }));

  return (
    <div ref={wrapRef} className="absolute right-4 top-4 z-[5002] sm:right-6 sm:top-6">
      <button
        type="button"
        aria-label={t("qs.title")}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-[38px] w-[38px] items-center justify-center rounded-full border border-transparent transition-colors hover:bg-[var(--ojs-iconbtn-hover)]"
        style={{ color: open ? "var(--ojs-accent-icon-fg)" : "var(--ojs-muted-fg)" }}
      >
        <SettingsGearIcon className="h-5 w-5" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t("qs.title")}
          className="ojs-pop-in fixed right-4 top-[60px] w-[min(462px,calc(100vw-2rem))] rounded-[24px] border p-6 sm:right-6 sm:top-[64px]"
          style={{
            backgroundColor: "var(--ojs-panel-bg)",
            borderColor: "var(--ojs-panel-border)",
            boxShadow:
              "rgba(0,0,0,0.33) 0px 8px 10px -6px, rgba(0,0,0,0.33) 0px 25px 50px -12px",
          }}
        >
          <h2 className="mb-5 text-[18px] font-semibold" style={{ color: "var(--ojs-page-fg)" }}>
            {t("qs.title")}
          </h2>

          <div className="flex flex-col gap-6">
            <SettingsCard>
              <SettingRow
                icon={<GlobeIcon className="h-5 w-5" />}
                title={t("qs.language")}
                desc={t("qs.languageDesc")}
              >
                <SelectPill
                  value={lang}
                  onChange={(v) => setLang(v as (typeof SUPPORTED_LANGS)[number])}
                  ariaLabel={t("qs.language")}
                  options={languageOptions}
                />
              </SettingRow>
              <RowDivider />
              <SettingRow
                icon={<MapPinIcon className="h-5 w-5" />}
                title={t("qs.region")}
                desc={t("qs.regionDesc")}
              >
                <SelectPill
                  value={region}
                  onChange={onRegionChange}
                  ariaLabel={t("qs.region")}
                  options={regionOptions}
                />
              </SettingRow>
            </SettingsCard>

            <SettingsCard>
              <SettingRow
                icon={<PaletteIcon className="h-5 w-5" />}
                title={t("qs.theme")}
                desc={t("qs.themeDesc")}
              >
                <div
                  className="flex items-center gap-1 rounded-full p-1"
                  style={{ backgroundColor: "var(--ojs-seg-bg)" }}
                >
                  {THEME_BUTTONS.map(({ value, key, Icon }) => {
                    const active = theme === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        aria-label={t(key)}
                        aria-pressed={active}
                        onClick={() => onThemeChange(value)}
                        className="flex h-7 w-7 items-center justify-center rounded-full transition-colors"
                        style={{
                          color: "var(--ojs-accent-pill-fg)",
                          backgroundColor: active ? "var(--ojs-seg-active-bg)" : "transparent",
                          boxShadow: active ? "rgba(0,0,0,0.33) 0px 1px 3px 0px" : "none",
                        }}
                      >
                        <Icon className="h-4 w-4" />
                      </button>
                    );
                  })}
                </div>
              </SettingRow>
            </SettingsCard>

            <SettingsCard>
              <SettingRow
                icon={<ChatIcon className="h-5 w-5" />}
                title={t("qs.feedback")}
                desc={t("qs.feedbackDesc")}
              >
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onOpenFeedback();
                  }}
                  className="flex h-9 items-center gap-1 rounded-full px-4 text-[12px] font-semibold transition-opacity hover:opacity-90"
                  style={{
                    backgroundColor: "var(--ojs-accent-pill-bg)",
                    color: "var(--ojs-accent-pill-fg)",
                  }}
                >
                  {t("qs.share")}
                  <ChevronDownIcon className="h-4 w-4 -rotate-90" />
                </button>
              </SettingRow>
            </SettingsCard>
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsCard({ children }: { children: ReactNode }) {
  return (
    <section
      className="overflow-hidden rounded-[16px]"
      style={{ backgroundColor: "var(--ojs-card-bg)" }}
    >
      {children}
    </section>
  );
}

function RowDivider() {
  return <div style={{ height: 2, backgroundColor: "var(--ojs-panel-bg)" }} />;
}

function SettingRow({
  icon,
  title,
  desc,
  children,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 p-4">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
          style={{
            backgroundColor: "var(--ojs-accent-icon-bg)",
            color: "var(--ojs-accent-icon-fg)",
          }}
        >
          {icon}
        </span>
        <div className="min-w-0">
          <h3
            className="text-[14px] font-semibold leading-[22px]"
            style={{ color: "var(--ojs-card-title)" }}
          >
            {title}
          </h3>
          <p className="text-[12px] leading-[16px]" style={{ color: "var(--ojs-muted-fg)" }}>
            {desc}
          </p>
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function SelectPill({
  value,
  onChange,
  ariaLabel,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  options: ReadonlyArray<{ value: string; label: string }>;
}) {
  return (
    <div className="relative inline-flex items-center">
      <select
        className="ojs-select"
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDownIcon
        className="pointer-events-none absolute right-3 h-4 w-4"
        style={{ color: "var(--ojs-accent-pill-fg)" }}
      />
    </div>
  );
}
