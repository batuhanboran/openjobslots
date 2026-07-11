import { GithubIcon, LinkedinIcon } from "@/components/icons";
import { REPO_URL, LINKEDIN_URL, VERSION_LABEL, APP_VERSION } from "@/lib/site";

interface SiteFooterProps {
  onOpenReleaseNotes: () => void;
  hasUnseenRelease: boolean;
}

export function SiteFooter({ onOpenReleaseNotes, hasUnseenRelease }: SiteFooterProps) {
  return (
    <footer
      className="relative z-[1] flex w-full flex-wrap items-center justify-center gap-x-3 gap-y-2 border-t px-4 py-2 text-center text-[12px] leading-[18px]"
      style={{
        color: "var(--ojs-footer-fg)",
        borderColor: "var(--ojs-footer-border)",
        backgroundColor: "var(--ojs-page-bg)",
      }}
    >
      <span>© OpenJobSlots</span>

      <a
        href={REPO_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="ojs-footer-link inline-flex items-center gap-1.5"
      >
        <GithubIcon className="h-[14px] w-[14px]" />
        <span>GitHub</span>
        <span
          className="rounded-full px-1.5 py-[1px] text-[10px] font-semibold"
          style={{
            backgroundColor: "var(--ojs-accent-pill-bg)",
            color: "var(--ojs-accent-pill-fg)",
          }}
        >
          Public Repo
        </span>
      </a>

      <a
        href={LINKEDIN_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="ojs-footer-link inline-flex items-center gap-1.5"
      >
        <LinkedinIcon className="h-[14px] w-[14px]" />
        <span>LinkedIn</span>
      </a>

      <button
        type="button"
        onClick={onOpenReleaseNotes}
        className="ojs-footer-link inline-flex items-center gap-1.5"
        aria-label={`Sürüm ${APP_VERSION} için sürüm notlarını aç`}
      >
        <span>{VERSION_LABEL}</span>
        {hasUnseenRelease && (
          <span className="relative inline-flex h-2 w-2">
            <span
              className="ojs-pulse-ring absolute inset-0 rounded-full"
              style={{ backgroundColor: "#ef4444" }}
            />
            <span
              className="relative inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: "#ef4444" }}
            />
          </span>
        )}
      </button>

      <style>{`
        .ojs-footer-link { color: var(--ojs-footer-fg); transition: color .12s ease; cursor: pointer; }
        .ojs-footer-link:hover { color: var(--ojs-page-fg); }
      `}</style>
    </footer>
  );
}
