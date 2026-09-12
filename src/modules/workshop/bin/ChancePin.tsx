import { XIcon } from "@phosphor-icons/react";
import { use } from "react";
import { twMerge } from "tailwind-merge";

import { IconButton, Slider } from "@/components";
import { m } from "@/i18n";

import { VfxRunContext } from "./vfx/run";

/** Where the slider rests while nothing is pinned, the middle of the chance. */
const MIDDLE = 0.5;

/** The finest chance the slider tells apart. */
const STEP = 0.01;

/**
 * The chance the run pins every birth at: a slider sets it and the cross lets it go.
 *
 * Nothing outside a run, where there is no birth to pin.
 */
export function ChancePin({ className }: { className?: string }) {
  const run = use(VfxRunContext);
  if (run === null) return null;
  const { pinned, setPinned } = run;
  const label = m.workshop_bin_random_chance_label();

  return (
    <span
      data-ui="ChancePin"
      className={twMerge(
        "flex shrink-0 items-center gap-2 font-sans text-meta text-surface-400 select-none",
        className,
      )}
    >
      {label}
      <Slider
        aria-label={m.workshop_bin_random_pin_action()}
        className={twMerge("w-28", pinned === null && "opacity-50")}
        min={0}
        max={1}
        step={STEP}
        value={pinned ?? MIDDLE}
        onValueChange={setPinned}
      />
      <span className="w-8 font-mono text-code text-accent-300 tabular-nums">
        {pinned === null ? "" : pinned.toFixed(2)}
      </span>
      {pinned !== null && (
        <IconButton
          variant="ghost"
          size="xs"
          compact
          aria-label={m.workshop_bin_random_unpin_action()}
          icon={<XIcon weight="bold" className="h-3 w-3" />}
          onClick={() => setPinned(null)}
        />
      )}
    </span>
  );
}
