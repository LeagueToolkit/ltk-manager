import { CaretDownIcon } from "@phosphor-icons/react";
import { type ReactNode, useId, useState } from "react";

import { Code } from "@/components";
import { twMerge } from "@/utils";

/** One term of a legend, and the one line saying what it means. */
export interface LegendTerm {
  term: string;
  meaning: string;
}

export interface LegendBarProps {
  title: string;
  terms: readonly LegendTerm[];
  /** Short sentences under the terms, for what no single term carries. */
  notes?: readonly string[];
  /** What sits at the end of the header, such as a link to the full reference. */
  action?: ReactNode;
  /** Whether the bar starts open. */
  defaultOpen?: boolean;
}

/**
 * A document's vocabulary along its bottom edge, collapsible to its own title.
 *
 * A legend beside the body takes width from the thing being read to say a
 * handful of short terms, and it is the narrow document, where the room is
 * worth most, that loses it first. Along the bottom the terms wrap instead.
 */
export function LegendBar({ title, terms, notes, action, defaultOpen = true }: LegendBarProps) {
  const [open, setOpen] = useState(defaultOpen);
  const body = useId();

  return (
    <section
      data-ui="LegendBar"
      className="shrink-0 border-t border-surface-700/50 bg-surface-950 select-none"
    >
      <div className="flex items-center gap-2 px-3 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((shown) => !shown)}
          aria-expanded={open}
          aria-controls={body}
          className="flex cursor-default items-center gap-1.5 rounded-sm text-meta text-surface-400 hover:text-surface-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
        >
          <CaretDownIcon
            className={twMerge(
              "h-3.5 w-3.5 transition-transform duration-200",
              !open && "-rotate-90",
            )}
          />
          {/* DS-TEXT */}
          <span className="text-xs font-medium tracking-wide uppercase">{title}</span>
        </button>

        {action && <div className="ml-auto">{action}</div>}
      </div>

      {open && (
        <div id={body} className="flex flex-col gap-1.5 px-3 pb-2">
          <dl className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-meta">
            {terms.map((entry) => (
              <div key={entry.term} className="flex items-center gap-1.5">
                <dt>
                  {/* DS-CODE-CHIP */}
                  <Code>{entry.term}</Code>
                </dt>
                <dd className="text-surface-400">{entry.meaning}</dd>
              </div>
            ))}
          </dl>

          {notes && notes.length > 0 && (
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-meta text-surface-500">
              {notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
