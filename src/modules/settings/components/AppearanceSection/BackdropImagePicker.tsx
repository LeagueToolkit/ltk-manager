import { ImageIcon } from "@phosphor-icons/react";

import { PathField, Slider } from "@/components";
import type { Settings } from "@/lib/tauri";

import { SettingRow } from "../SettingRow";
import { useDebouncedSlider } from "./useDebouncedSlider";

interface BackdropImagePickerProps {
  settings: Settings;
  onSave: (settings: Settings) => void;
}

const IMAGE_FILTERS = [
  { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif"] },
];

/* Wide enough to read a filename, and free to give width back when the window is
   narrow - a rigid slot would crowd the label off its own row. */
const controlClass = "w-72 shrink";

export function BackdropImagePicker({ settings, onSave }: BackdropImagePickerProps) {
  const [localBlur, handleBlurChange] = useDebouncedSlider(settings.backdropBlur ?? 40, (blur) => {
    onSave({ ...settings, backdropBlur: blur });
  });

  return (
    <>
      <SettingRow
        kind="action"
        title="Background image"
        description="Sits behind the UI, under a frosted glass effect."
        controlClassName={controlClass}
        control={
          <PathField
            pick="file"
            filters={IMAGE_FILTERS}
            display="name"
            aria-label="Background image"
            value={settings.backdropImage}
            onSelect={(path) => onSave({ ...settings, backdropImage: path })}
            onClear={() => onSave({ ...settings, backdropImage: null })}
            placeholder="No image selected"
            dialogTitle="Select Background Image"
            browseIcon={<ImageIcon weight="bold" className="h-5 w-5" />}
          />
        }
      />

      {settings.backdropImage && (
        <SettingRow
          kind="action"
          title="Blur"
          description="How far the image is softened behind the glass."
          controlClassName={controlClass}
          control={
            <div className="flex items-center gap-3">
              <Slider
                value={localBlur}
                onValueChange={handleBlurChange}
                min={0}
                max={100}
                aria-label="Background blur"
              />
              <span className="w-10 shrink-0 text-right font-mono text-xs text-surface-300">
                {localBlur}px
              </span>
            </div>
          }
        />
      )}
    </>
  );
}
