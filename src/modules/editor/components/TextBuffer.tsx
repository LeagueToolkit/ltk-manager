import { type ReactNode, type RefObject, useEffect, useRef } from "react";

import { twMerge } from "@/utils";

import type { TextMatch } from "../useTextFind";

/** How much of the buffer's height a match reveals itself in, when it has to scroll. */
const REVEAL_FRACTION = 0.5;

/* One array for every buffer with no find open, so the effects below rest. */
const NO_MATCHES: readonly TextMatch[] = [];

export interface TextBufferProps {
  value: string;
  onChange: (next: string) => void;
  /** The buffer's own name, for a reader that cannot see the document around it. */
  ariaLabel: string;
  spellCheck?: boolean;
  /** Draw the text for reading and selecting only. */
  readOnly?: boolean;
  /** What a find matched, painted behind the text. */
  matches?: readonly TextMatch[];
  /** Which of `matches` the find bar sits on, and -1 for none. */
  current?: number;
  bufferRef?: RefObject<HTMLTextAreaElement | null>;
  /** Anything that rides the buffer's scroll, a line gutter among them. */
  onScroll?: (scrollTop: number) => void;
  /** Padding and typography. The highlights take the same, so the two agree. */
  className?: string;
  /** The box both layers fill, which carries the ground and the scroll clip. */
  wrapperClassName?: string;
}

/**
 * One editable buffer, with a find's matches painted behind its text.
 *
 * A textarea cannot mark a range inside itself, so the matches are drawn by a
 * transparent copy of the text under it. The two layers hold the same box,
 * padding and wrapping and scroll together, or a mark lands off its word.
 */
export function TextBuffer({
  value,
  onChange,
  ariaLabel,
  spellCheck,
  readOnly,
  matches,
  current = -1,
  bufferRef,
  onScroll,
  className,
  wrapperClassName,
}: TextBufferProps) {
  const own = useRef<HTMLTextAreaElement>(null);
  const area = bufferRef ?? own;
  const highlights = useRef<HTMLDivElement>(null);
  const mark = useRef<HTMLElement | null>(null);

  const found = matches ?? NO_MATCHES;

  /* The layer under the text holds no scroll of its own to be driven by, so
     every render that can move the text moves it too. */
  useEffect(() => {
    const layer = highlights.current;
    if (layer && area.current) layer.scrollTop = area.current.scrollTop;
  }, [area, value, found]);

  /* Selected in the buffer as well as marked, so a close of the bar leaves the
     caret on the match. */
  useEffect(() => {
    const target = found[current];
    const element = area.current;
    if (!target || !element) return;

    element.setSelectionRange(target.start, target.end);

    const layer = highlights.current;
    const marked = mark.current;
    if (!layer || !marked) return;

    const height = layer.clientHeight;
    const top = marked.offsetTop;
    const above = top < element.scrollTop;
    const below = top + marked.offsetHeight > element.scrollTop + height;
    if (above || below) {
      const wanted = Math.max(0, top - height * REVEAL_FRACTION);
      element.scrollTop = wanted;
      layer.scrollTop = wanted;
    }
  }, [area, current, found]);

  function handleScroll(scrollTop: number) {
    if (highlights.current) highlights.current.scrollTop = scrollTop;
    onScroll?.(scrollTop);
  }

  return (
    <div
      className={twMerge(
        "relative min-h-0 min-w-0 flex-1 overflow-hidden bg-surface-950",
        wrapperClassName,
      )}
    >
      {/* `overflow-y-scroll` on both layers, so the room a track takes is the
          same in each and a line wraps at the same column in both. */}
      <div
        ref={highlights}
        aria-hidden
        className={twMerge(
          "pointer-events-none absolute inset-0 overflow-y-scroll break-words whitespace-pre-wrap text-transparent scrollbar-md select-none",
          className,
        )}
      >
        {markedText(value, found, current, mark)}
      </div>

      <textarea
        ref={area}
        value={value}
        spellCheck={spellCheck}
        readOnly={readOnly}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.value)}
        onScroll={(event) => handleScroll(event.currentTarget.scrollTop)}
        className={twMerge(
          "absolute inset-0 h-full w-full resize-none overflow-y-scroll bg-transparent break-words text-surface-200 outline-none scrollbar-md",
          className,
        )}
      />
    </div>
  );
}

/* A match is dense inline chrome: DS-RADIUS. */
function markedText(
  text: string,
  matches: readonly TextMatch[],
  current: number,
  currentRef: RefObject<HTMLElement | null>,
): ReactNode {
  if (matches.length === 0) return text;

  const parts: ReactNode[] = [];
  let at = 0;

  matches.forEach((match, index) => {
    if (match.start > at) parts.push(text.slice(at, match.start));

    const on = index === current;
    parts.push(
      <mark
        key={`${match.start}`}
        ref={on ? currentRef : null}
        className={twMerge(
          "rounded-sm text-transparent",
          on ? "bg-accent-500/55" : "bg-accent-500/25",
        )}
      >
        {text.slice(match.start, match.end)}
      </mark>,
    );
    at = match.end;
  });

  parts.push(text.slice(at));
  return parts;
}
