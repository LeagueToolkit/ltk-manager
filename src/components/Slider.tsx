import { Slider as BaseSlider } from "@base-ui/react/slider";
import { twMerge } from "tailwind-merge";

interface Mark {
  value: number;
  label?: string;
}

interface SliderProps {
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  marks?: Mark[];
  label?: string;
  "aria-label"?: string;
  disabled?: boolean;
  className?: string;
}

export function Slider({
  value,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  marks,
  label,
  "aria-label": ariaLabel,
  disabled,
  className,
}: SliderProps) {
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
      className={twMerge("flex w-full flex-col gap-2", className)}
    >
      {label && <span className="text-sm font-medium text-surface-200">{label}</span>}

      <BaseSlider.Control className="relative flex h-4 w-full touch-none items-center">
        <BaseSlider.Track
          className={twMerge(
            "relative h-1.5 w-full rounded-full bg-surface-700",
            disabled && "opacity-50",
          )}
        >
          <BaseSlider.Indicator className="absolute h-full rounded-full bg-accent-500" />

          {/* Step dots along the rail */}
          {marks &&
            marks.map((mark) => {
              const pct = ((mark.value - min) / (max - min)) * 100;
              const isActive = mark.value <= value;
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

          <BaseSlider.Thumb
            aria-label={ariaLabel ?? label}
            className={twMerge(
              "absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-on shadow-md",
              "focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-900 focus-visible:outline-none",
              "data-[dragging]:scale-110",
              "transition-[transform,box-shadow]",
              disabled ? "cursor-not-allowed" : "cursor-pointer data-[dragging]:cursor-grabbing",
            )}
          />
        </BaseSlider.Track>
      </BaseSlider.Control>

      {marks && marks.length > 0 && (
        <div className="relative h-5 w-full">
          {marks.map((mark) => {
            const pct = ((mark.value - min) / (max - min)) * 100;
            return (
              <span
                key={mark.value}
                className={twMerge(
                  "absolute -translate-x-1/2 text-xs",
                  mark.value === value ? "font-medium text-surface-100" : "text-surface-400",
                )}
                style={{ left: `${pct}%` }}
              >
                {mark.label ?? mark.value}
              </span>
            );
          })}
        </div>
      )}
    </BaseSlider.Root>
  );
}
