// @vitest-environment happy-dom

import { render } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { ANTI_ALIASING_PRIORITY } from "../AntiAliasingPass";
import { type CaptureFrame, FrameCapture } from "../FrameCapture";

const invalidate = vi.fn();
let drawFrame: (state: { gl: { domElement: { toBlob: BlobCallback } } }) => void;
let framePriority: number;

vi.mock("@react-three/fiber", () => ({
  useThree: (select: (state: { invalidate: () => void }) => unknown) => select({ invalidate }),
  useFrame: (callback: typeof drawFrame, priority: number) => {
    drawFrame = callback;
    framePriority = priority;
  },
}));

describe("FrameCapture", () => {
  it("reads one PNG from the next frame after a request", async () => {
    const handle = createRef<CaptureFrame>();
    render(<FrameCapture handle={handle} />);
    const blob = new Blob();
    const toBlob = vi.fn((done: BlobCallback) => done(blob));
    const gl = { domElement: { toBlob } } as never;

    drawFrame({ gl });
    expect(toBlob).not.toHaveBeenCalled();

    const image = handle.current?.();
    expect(invalidate).toHaveBeenCalledOnce();

    drawFrame({ gl });
    drawFrame({ gl });
    expect(toBlob).toHaveBeenCalledOnce();
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/png");
    await expect(image).resolves.toBe(blob);
  });

  it("reads the frame between the anti-aliasing and the HUD", () => {
    render(<FrameCapture handle={createRef()} />);

    expect(framePriority).toBeGreaterThan(ANTI_ALIASING_PRIORITY);
    expect(framePriority).toBeLessThan(2);
  });
});
