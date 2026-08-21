import { twMerge } from "tailwind-merge";

import skinhackMark from "@/assets/game/skinhack.png";
import type { Incident } from "@/lib/tauri";

import { isSkinhackRejection } from "../utils/incident";
import { ConsequenceChip } from "./ConsequenceChip";
import { VerdictGlyph } from "./VerdictGlyph";

interface VerdictCardProps {
  incident: Incident;
}

/**
 * The heading a caught skinhack reads under, in place of the verdict's own.
 *
 * The rail has room for the finding and the card has room for the verb, so the
 * two say the same thing at the length each has.
 */
const SKINHACK_TITLE = "Skinhack detection triggered";

/** The verdict as the player reads it first: the title, what it cost, and the cause. */
export function VerdictCard({ incident }: VerdictCardProps) {
  const { verdict } = incident;
  const skinhack = isSkinhackRejection(incident);
  const title = skinhack ? SKINHACK_TITLE : verdict.title;

  return (
    <section
      data-ui="VerdictCard"
      className={twMerge(
        "flex items-start rounded-lg border border-surface-700/50 bg-surface-900/95",
        /* The hue names the kind rather than a status: DS-KIND-HUE. */
        skinhack && "border-void/50 bg-linear-to-r from-void/20 via-void/10 to-void/5",
      )}
    >
      {skinhack && (
        <img
          data-ui="VerdictCard:skinhack-mark"
          src={skinhackMark}
          alt=""
          draggable={false}
          className="m-1 h-40 w-40 shrink-0 self-center select-none"
        />
      )}
      {/* The art supplies the left inset when it is there, so only a card
          without it needs padding of its own on that side. */}
      <div className={twMerge("min-w-0 flex-1 px-2 py-4", !skinhack && "p-4")}>
        <div className="flex flex-wrap items-center gap-2">
          {/* Glyphs take the -text variant: DS-TEXT. */}
          <VerdictGlyph
            kind={verdict.kind}
            className={twMerge("mt-0.5 h-5 w-5 shrink-0", skinhack && "text-void-text")}
          />
          <h2
            className={twMerge(
              "text-base font-semibold text-surface-100",
              skinhack && "text-void-text",
            )}
          >
            {title}
          </h2>
          <ConsequenceChip consequence={verdict.consequence} />
          {incident.dismissed && (
            <span className="inline-flex h-5 items-center rounded-sm border border-surface-600 px-1.5 text-[10px] font-medium tracking-wider text-surface-400 uppercase">
              Dismissed
            </span>
          )}
        </div>
        <p className="mt-1 text-sm leading-relaxed text-surface-300">{verdict.cause}</p>
        {verdict.subject && (
          /* An inset inside a card is the one place a lower rung is right: DS-GROUND. */
          <p
            data-ui="VerdictCard:subject"
            className="mt-3 rounded-md border border-surface-700/60 bg-surface-950/50 px-2 py-1.5 font-mono text-xs break-all text-surface-100"
          >
            {verdict.subject}
          </p>
        )}
      </div>
    </section>
  );
}
