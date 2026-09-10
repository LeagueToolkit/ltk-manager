import type { ReactNode } from "react";

import { m } from "@/i18n";
import { twMerge } from "@/utils";

import { stripReleasePreamble } from "../api";
import { ChangelogContent } from "./ChangelogContent";

const CHIP =
  "inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[0.625rem] leading-tight font-medium";

/* Accent marks the release on offer. The installed one and a pre-release name
   no status, so both take the surface: DS-KIND-HUE. */
const PENDING_CHIP = "bg-accent-500/15 text-accent-400";
const SURFACE_CHIP = "bg-surface-700 text-surface-300";

interface ReleaseSectionProps {
  /** The release's version, without a leading `v`. */
  version: string;
  /** The release's own markdown, preamble and all. */
  body: string | undefined;
  /** When the release shipped, RFC 3339, or `null` for one with no date to show. */
  publishedAt?: string | null;
  prerelease?: boolean;
  /** The release the dialog offers to install, which opens the scroll. */
  pending?: boolean;
  /** The release the build runs, which is what Home marks. */
  installed?: boolean;
  /** A control at the header's trailing edge, such as the Update button Home gives a pending release. */
  action?: ReactNode;
}

/** One release: which version it is, when it shipped, and what it changed. */
export function ReleaseSection({
  version,
  body,
  publishedAt,
  prerelease = false,
  pending = false,
  installed = false,
  action,
}: ReleaseSectionProps) {
  const date = releaseDate(publishedAt);

  return (
    <section data-ui="ReleaseSection" className="py-4">
      <header className="mb-2 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-surface-100 select-text">v{version}</h3>
        {installed && (
          <span className={twMerge(CHIP, SURFACE_CHIP)}>{m.updater_release_installed_label()}</span>
        )}
        {pending && (
          <span className={twMerge(CHIP, PENDING_CHIP)}>{m.updater_release_pending_label()}</span>
        )}
        {prerelease && (
          <span className={twMerge(CHIP, SURFACE_CHIP)}>
            {m.updater_release_prerelease_label()}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {date && (
            <time dateTime={publishedAt ?? undefined} className="text-xs text-surface-500">
              {date}
            </time>
          )}
          {action}
        </span>
      </header>
      <div className="select-text">
        <ChangelogContent body={stripReleasePreamble(body)} />
      </div>
    </section>
  );
}

/** The day a release shipped, in the reader's locale, or `null` for a date nothing can parse. */
function releaseDate(publishedAt: string | null | undefined): string | null {
  if (!publishedAt) return null;

  const date = new Date(publishedAt);
  if (Number.isNaN(date.getTime())) return null;

  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
