import { Slider as BaseSlider } from "@base-ui/react/slider";
import { twMerge } from "tailwind-merge";

interface Mark {
  value: number;
  label?: string;
}

export type SliderVariant = "default" | "ruler";

interface SliderProps {
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  marks?: Mark[];
  label?: string;
  "aria-label"?: string;
  /** `ruler` fills the rail to the value and ticks its stops, with no handle. */
  variant?: SliderVariant;
  disabled?: boolean;
  className?: string;
}

/* A label at either end would hang half outside the rail, so the outermost two
   are pinned to its edges instead of centred on their position. Ticks stay
   centred - two pixels wide, they have nothing to hang. */
function labelShift(index: number, count: number): string {
  if (index === 0) return "translate-x-0";
  if (index === count - 1) return "-translate-x-full";
  return "-translate-x-1/2";
}

/* The spring overshoots, so the rail clips it rather than letting the fill poke
   past its cap at full value. Reduce motion collapses every transition globally,
   so the fill snaps there without a second code path.

   No data-dragging opt-out: pointerdown sets that flag before the value lands, so
   it would suppress the animation on a plain click, not just on a drag. */
const indicatorMotion = "transition-[width] duration-300 ease-[var(--ease-spring)]";

export function Slider({
  value,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  marks,
  label,
  "aria-label": ariaLabel,
  variant = "default",
  disabled,
  className,
}: SliderProps) {
  const isRuler = variant === "ruler";

  return (
    <BaseSlider.Root
      value={value}
      onValueChange={(val) => {
        const next = typeof val === "number" ? val : val[0];
        onValueChange(next);
      }}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      className={twMerge("flex w-full flex-col", isRuler ? "gap-1.5" : "gap-2", className)}
    >
      {label && <span className="text-sm font-medium text-surface-200">{label}</span>}

      <BaseSlider.Control className="relative flex h-4 w-full touch-none items-center">
        <BaseSlider.Track
          className={twMerge(
            "relative w-full overflow-hidden rounded-full bg-surface-700",
            isRuler ? "h-1" : "h-1.5",
            disabled && "opacity-50",
          )}
        >
          <BaseSlider.Indicator
            className={twMerge("absolute h-full rounded-full bg-accent-500", indicatorMotion)}
          />
        </BaseSlider.Track>

        {/* Outside the rail, so clipping the fill's overshoot leaves them alone. */}
        {marks?.map((mark) => {
          const pct = ((mark.value - min) / (max - min)) * 100;
          const isActive = mark.value <= value;

          if (isRuler) {
            return (
              <span
                key={mark.value}
                className={twMerge(
                  "group/mark absolute top-1/2 flex h-4 w-6 -translate-x-1/2 -translate-y-1/2",
                  "items-center justify-center",
                  disabled ? "cursor-not-allowed" : "cursor-pointer",
                )}
                style={{ left: `${pct}%` }}
              >
                <span
                  className={twMerge(
                    "h-3 w-0.5 rounded-full transition-colors",
                    isActive ? "bg-accent-400" : "bg-surface-500",
                    !disabled && "group-hover/mark:bg-accent-300",
                  )}
                />
              </span>
            );
          }

          return (
            <span
              key={mark.value}
              className={twMerge(
                "absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full",
                isActive ? "bg-accent-400" : "bg-surface-500",
              )}
              style={{ left: `${pct}%` }}
            />
          );
        })}

        {/* The handle still carries the slider's role, value and key handling,
            so the ruler hides it rather than dropping it.

            Squared and accent-toned rather than a white disc: DS-RADIUS. Its edge
            is an accent rung because the slider sits on a card, and a ring darker
            than that card reads as a hole in it: DS-GROUND. 700 rather than a
            lighter rung because a green or teal accent leaves 400 and 500 inside
            one JND of each other, so only the dark end of the ramp separates the
            knob from its own fill at every hue.

            Dragging grows it lengthways. A knob this narrow has too little width
            for a uniform scale to register. */}
        <BaseSlider.Thumb
          aria-label={ariaLabel ?? label}
          className={twMerge(
            "absolute top-1/2 -translate-x-1/2 -translate-y-1/2",
            isRuler
              ? "h-4 w-1 rounded-full bg-transparent focus-visible:ring-2 focus-visible:ring-accent-300 focus-visible:outline-none"
              : "h-4 w-2 rounded-sm bg-accent-400 ring-1 ring-accent-700 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-300 data-[dragging]:scale-y-125",
            !isRuler && !disabled && "hover:bg-accent-300",
            disabled ? "cursor-not-allowed" : "cursor-pointer data-[dragging]:cursor-grabbing",
          )}
        />
      </BaseSlider.Control>

      {marks && marks.length > 0 && (
        <div className={twMerge("relative w-full", isRuler ? "h-4" : "h-5")}>
          {marks.map((mark, index) => (
            <span
              key={mark.value}
              className={twMerge(
                "absolute text-xs tabular-nums",
                labelShift(index, marks.length),
                mark.value === value ? "font-medium text-surface-100" : "text-surface-400",
              )}
              style={{ left: `${((mark.value - min) / (max - min)) * 100}%` }}
            >
              {mark.label ?? mark.value}
            </span>
          ))}
        </div>
      )}
    </BaseSlider.Root>
  );
}
