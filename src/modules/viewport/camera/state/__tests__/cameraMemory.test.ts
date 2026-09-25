import { expect, it } from "vitest";

import { type CameraPose, lastCameraPose, recordCameraPose } from "../cameraMemory";

const POSE: CameraPose = { preset: "orbit", position: [1, 2, 3], target: [0, 0, 0], zoom: 1 };

it("returns the last pose recorded under a key for the preset it was recorded under", () => {
  recordCameraPose("vfx-test", { ...POSE, position: [1, 2, 3] });
  recordCameraPose("vfx-test", { ...POSE, position: [4, 5, 6] });

  expect(lastCameraPose("vfx-test", "orbit")?.position).toEqual([4, 5, 6]);
});

it("returns no pose for another preset or an unknown key", () => {
  recordCameraPose("vfx-preset-test", POSE);

  expect(lastCameraPose("vfx-preset-test", "top")).toBeNull();
  expect(lastCameraPose("never-recorded", "orbit")).toBeNull();
});
