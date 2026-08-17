import { SelectField } from "@/components";
import type { ZoomLevel } from "@/stores";
import { useSetZoomLevel, useZoomLevel, VALID_ZOOM_LEVELS } from "@/stores";

const OPTIONS = VALID_ZOOM_LEVELS.map((level) => ({
  value: String(level),
  label: level === 100 ? "100% (default)" : `${level}%`,
}));

export function ZoomLevelPicker() {
  const zoomLevel = useZoomLevel();
  const setZoomLevel = useSetZoomLevel();

  return (
    <SelectField
      options={OPTIONS}
      value={String(zoomLevel)}
      onValueChange={(value) => value && setZoomLevel(Number(value) as ZoomLevel)}
      triggerClassName="w-40"
    />
  );
}
