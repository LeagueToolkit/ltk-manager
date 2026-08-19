import { Slider } from "@/components";
import { useSetSurfaceTint, useSurfaceTint } from "@/stores";

/* No debounce, unlike the sliders that write settings: this one only sets a custom
   property, so the ramp can follow the handle. */
export function SurfaceTintPicker() {
  const surfaceTint = useSurfaceTint();
  const setSurfaceTint = useSetSurfaceTint();

  return (
    <div className="flex items-center gap-3">
      <Slider
        value={surfaceTint}
        onValueChange={setSurfaceTint}
        min={0}
        max={100}
        step={5}
        aria-label="Surface tint"
      />
      <span className="w-10 shrink-0 text-right font-mono text-xs text-surface-300">
        {surfaceTint}%
      </span>
    </div>
  );
}
