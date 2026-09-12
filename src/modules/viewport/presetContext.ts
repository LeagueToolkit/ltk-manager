import { createContext, use } from "react";

import type { CameraPreset } from "./cameraPresets";

/** The preset the enclosing viewport draws through, which a fit inside it frames for. */
export const CameraPresetContext = createContext<CameraPreset>("orbit");

/** The preset of the viewport the caller sits in. */
export function useCameraPreset(): CameraPreset {
  return use(CameraPresetContext);
}
