import { useFrame } from "@react-three/fiber";
import { useRef } from "react";

import { FAILED_OUTCOME, type PreviewOutcome } from "../state/previewStills";

interface PreviewCaptureProps {
  /** Assets have landed and the scene is at the moment to capture. Frames count from here. */
  ready: boolean;
  onOutcome: (outcome: PreviewOutcome) => void;
  /** Whether the frame has anything drawn, which a capture waits for. */
  hasContent?: () => boolean;
}

/** A still after assets and camera have settled, copied immediately after the colour pass. */
export function PreviewCapture({ ready, onOutcome, hasContent }: PreviewCaptureProps) {
  const frames = useRef(0);
  const captured = useRef(false);

  useFrame(({ gl, controls }) => {
    if (!ready || !controls || captured.current) {
      return;
    }

    frames.current += 1;
    if (frames.current < 2 || (hasContent && !hasContent())) {
      return;
    }

    captured.current = true;
    try {
      const image = gl.domElement.toDataURL("image/webp", 0.75);
      onOutcome(image.startsWith("data:image/") ? { kind: "image", src: image } : FAILED_OUTCOME);
    } catch {
      onOutcome(FAILED_OUTCOME);
    }
  }, 2);

  return null;
}
