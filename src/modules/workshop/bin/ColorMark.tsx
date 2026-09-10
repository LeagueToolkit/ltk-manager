import { Popover } from "@/components";
import { m } from "@/i18n";
import { twMerge } from "@/utils";

import { CHECKERBOARD } from "../preview/ImagePreview";
import { colorCss, colorHex, type ColorStop, gradientCss } from "./valueRows";

/** Hover for this long opens the card, the tooltip delay. */
const CARD_DELAY = 600;

/**
 * The room the strip takes, which is one vector component's.
 *
 * A column of value rows mixes colours, floats and vectors, and one width across them
 * is what keeps the readouts under each other.
 */
const STRIP_WIDTH = "w-24";

interface ColorMarkProps {
  /** The row's `constantValue`, each channel 0 to 1. Null where the file writes none. */
  constant: ColorStop["rgba"] | null;
  /** The dynamics' stops, in the curve's own order. Empty where it has none. */
  stops: readonly ColorStop[];
}

/**
 * A `ValueColor`'s constant as a swatch, and its dynamics as a strip of its stops.
 *
 * "A value family on its row" in docs/ux/BIN_EDITOR.md. A colour with no dynamics
 * draws the swatch alone, and one whose file writes no constant draws the strip alone.
 */
export function ColorMark({ constant, stops }: ColorMarkProps) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {constant !== null && <Swatch rgba={constant} />}
      {stops.length > 0 && <Strip stops={stops} />}
    </span>
  );
}

/** One colour over the checkerboard, so an alpha reads as one rather than as a tint. */
export function Swatch({ rgba, className }: { rgba: ColorStop["rgba"]; className?: string }) {
  return (
    <span
      /* DS-TOKEN, DS-VEIL, DS-RADIUS */
      className={twMerge(
        `h-3.5 w-3.5 shrink-0 overflow-hidden rounded-sm border border-surface-veil-strong ${CHECKERBOARD} [background-size:6px_6px]`,
        className,
      )}
      aria-hidden
    >
      <span className="block h-full w-full" style={{ background: colorCss(rgba) }} />
    </span>
  );
}

/** The curve as one band, and its stops on the card. */
function Strip({ stops }: { stops: readonly ColorStop[] }) {
  const trigger = (
    <span
      data-ui="ColorMark:strip"
      aria-label={m.workshop_bin_gradient_label({ count: stops.length })}
      /* DS-TOKEN, DS-VEIL, DS-RADIUS */
      className={`h-3.5 shrink-0 overflow-hidden rounded-sm border border-surface-veil-strong ${STRIP_WIDTH} ${CHECKERBOARD} [background-size:6px_6px]`}
    >
      <span className="block h-full w-full" style={{ background: gradientCss(stops) }} />
    </span>
  );

  return (
    <Popover.Root>
      <Popover.Trigger openOnHover delay={CARD_DELAY} render={trigger} />
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6}>
          <Popover.Popup
            aria-label={m.workshop_bin_gradient_label({ count: stops.length })}
            className="w-64 p-3 text-meta select-none"
          >
            <StopList stops={stops} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Every stop, as the time it lands at and the colour there. */
function StopList({ stops }: { stops: readonly ColorStop[] }) {
  return (
    <div data-ui="ColorMark:card" className="flex flex-col gap-2">
      <span className="text-surface-400">
        {m.workshop_bin_gradient_label({ count: stops.length })}
      </span>
      <dl className="grid max-h-64 grid-cols-[auto_auto_1fr] items-center gap-x-3 gap-y-1 overflow-auto scrollbar-sm">
        {stops.map((stop, at) => (
          <div key={at} className="col-span-3 grid grid-cols-subgrid items-center">
            <dt className="font-mono text-code text-surface-400 tabular-nums select-text">
              {stop.time.toFixed(3)}
            </dt>
            <dd className="flex">
              <Swatch rgba={stop.rgba} />
            </dd>
            <dd className="font-mono text-code text-surface-200 select-text">
              {colorHex(stop.rgba)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
