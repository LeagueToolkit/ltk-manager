import { useFrame, useThree } from "@react-three/fiber";
import { type RefObject, useImperativeHandle, useRef } from "react";

/** After the anti-aliasing at 1.75 and before the HUD at 2, so the gizmo stays out of the image. */
const CAPTURE_PRIORITY = 1.9;

/** Captures the next finished frame as a PNG. Resolves to null if the encoding fails. */
export type CaptureFrame = () => Promise<Blob | null>;

/** Writes a `CaptureFrame` for the surrounding canvas to `handle`. */
export function FrameCapture({ handle }: { handle: RefObject<CaptureFrame | null> }) {
  const invalidate = useThree((state) => state.invalidate);
  const pending = useRef<BlobCallback | null>(null);

  useImperativeHandle(
    handle,
    () => () =>
      new Promise((resolve) => {
        pending.current = resolve;
        invalidate();
      }),
    [invalidate],
  );

  useFrame(({ gl }) => {
    if (pending.current === null) return;

    /* The drawing buffer is valid only until this task ends, and `toBlob` snapshots it on the call. */
    gl.domElement.toBlob(pending.current, "image/png");
    pending.current = null;
  }, CAPTURE_PRIORITY);

  return null;
}
