import { ImageIcon } from "@phosphor-icons/react";

import { PathField } from "@/components";
import type { Settings } from "@/lib/tauri";

import { useDebouncedSlider } from "./useDebouncedSlider";

interface BackdropImagePickerProps {
  settings: Settings;
  onSave: (settings: Settings) => void;
}

const IMAGE_FILTERS = [
  { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif"] },
];

export function BackdropImagePicker({ settings, onSave }: BackdropImagePickerProps) {
  const [localBlur, handleBlurChange] = useDebouncedSlider(settings.backdropBlur ?? 40, (blur) => {
    onSave({ ...settings, backdropBlur: blur });
  });

  return (
    <div className="space-y-3">
      <PathField
        pick="file"
        filters={IMAGE_FILTERS}
        label="Background Image"
        value={settings.backdropImage}
        onSelect={(path) => onSave({ ...settings, backdropImage: path })}
        onClear={() => onSave({ ...settings, backdropImage: null })}
        placeholder="No image selected"
        dialogTitle="Select Background Image"
        browseIcon={<ImageIcon weight="bold" className="h-5 w-5" />}
        description="Set a background image for the app. The UI will render with a frosted glass effect over the image."
      />

      {settings.backdropImage && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-surface-400">Blur Amount</span>
            <span className="text-xs text-surface-300">{localBlur}px</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={localBlur}
            onChange={(e) => handleBlurChange(Number(e.target.value))}
            className="h-2 w-full cursor-pointer appearance-none rounded-full bg-surface-600"
          />
        </div>
      )}
    </div>
  );
}
