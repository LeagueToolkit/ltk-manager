import { Tooltip } from "@/components";
import type { CornerStyle } from "@/stores";
import { useCornerStyle, useSetCornerStyle } from "@/stores";

/* Fixed px, not scale tokens: a preview has to keep showing its own level while the
   live scale is set to another one. */
const CORNER_OPTIONS: { value: CornerStyle; label: string; preview: string }[] = [
  { value: "sharp", label: "Sharp", preview: "0px" },
  { value: "default", label: "Default", preview: "5px" },
  { value: "round", label: "Round", preview: "10px" },
];

const previewClass =
  "h-6 w-6 border-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500";
const activePreviewClass = "border-accent-400 bg-accent-500/30";
const idlePreviewClass = "border-surface-400 bg-surface-400/25 hover:border-surface-300";

export function CornerStylePicker() {
  const cornerStyle = useCornerStyle();
  const setCornerStyle = useSetCornerStyle();

  return (
    <div className="flex items-center gap-2">
      {CORNER_OPTIONS.map(({ value, label, preview }) => (
        <Tooltip key={value} content={label}>
          <button
            type="button"
            onClick={() => setCornerStyle(value)}
            aria-label={label}
            aria-pressed={cornerStyle === value}
            className={`${previewClass} ${cornerStyle === value ? activePreviewClass : idlePreviewClass}`}
            style={{ borderRadius: preview }}
          />
        </Tooltip>
      ))}
    </div>
  );
}
