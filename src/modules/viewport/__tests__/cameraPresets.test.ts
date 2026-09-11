import { describe, expect, it } from "vitest";

import {
  CAMERA,
  CAMERA_PRESETS,
  CAMERA_STANDS,
  openingLook,
  presetFacing,
  upAcross,
} from "../cameraPresets";

/** The pitch of `game`, in degrees above the horizontal of its own look vector. */
function pitchOf(look: readonly [number, number, number]): number {
  return (Math.atan2(look[1], Math.hypot(look[0], look[2])) * 180) / Math.PI;
}

describe("CAMERA_STANDS", () => {
  it("holds one stand per preset the menu lists", () => {
    expect(CAMERA_PRESETS.map((preset) => CAMERA_STANDS[preset])).toHaveLength(5);
  });

  it("looks along a unit vector from every preset", () => {
    for (const preset of CAMERA_PRESETS) {
      const { look } = CAMERA_STANDS[preset];
      expect(Math.hypot(look[0], look[1], look[2])).toBeCloseTo(1, 6);
    }
  });

  it("puts up across the look of every preset", () => {
    for (const preset of CAMERA_PRESETS) {
      const { look, up } = CAMERA_STANDS[preset];
      const along = look[0] * up[0] + look[1] * up[1] + look[2] * up[2];
      expect(Math.abs(along)).toBeLessThan(1);
    }
  });

  it("stands the match camera 56 degrees over the negative Z of what it holds", () => {
    const { look, fov, orthographic } = CAMERA_STANDS.game;

    expect(pitchOf(look)).toBeCloseTo(56, 6);
    expect(look[0]).toBe(0);
    expect(look[2]).toBeLessThan(0);
    expect(fov).toBe(40);
    expect(orthographic).toBe(false);
  });

  it("holds the match camera between the game's two zooms, and every other preset free", () => {
    expect(CAMERA_STANDS.game.zoom).toEqual({ nearest: 1000, farthest: 2250 });
    for (const preset of CAMERA_PRESETS) {
      if (preset !== "game") expect(CAMERA_STANDS[preset].zoom).toBeNull();
    }
  });

  it("opens orbit where the scene's own camera opens", () => {
    expect(CAMERA_STANDS.orbit.look).toEqual(openingLook());
    expect(CAMERA_STANDS.orbit.fov).toBe(CAMERA.fov);
  });

  it("projects the three axis views flat and nothing else", () => {
    const flat = CAMERA_PRESETS.filter((preset) => CAMERA_STANDS[preset].orthographic);
    expect(flat).toEqual(["top", "front", "side"]);
  });
});

describe("presetFacing", () => {
  it("names the flat preset standing on each positive axis", () => {
    expect(presetFacing([0, 1, 0])).toBe("top");
    expect(presetFacing([0, 0, 1])).toBe("front");
    expect(presetFacing([1, 0, 0])).toBe("side");
  });

  it("is orbit from a negative axis and from any look no preset stands on", () => {
    expect(presetFacing([-1, 0, 0])).toBe("orbit");
    expect(presetFacing([0, -1, 0])).toBe("orbit");
    expect(presetFacing([0, 0, -1])).toBe("orbit");
    expect(presetFacing(CAMERA_STANDS.game.look)).toBe("orbit");
  });
});

describe("upAcross", () => {
  it("puts the world's Z up on a look down either end of the up axis", () => {
    expect(upAcross([0, 1, 0])).toEqual(CAMERA_STANDS.top.up);
    expect(upAcross([0, -1, 0])).toEqual(CAMERA_STANDS.top.up);
  });

  it("keeps the world's up on every other look", () => {
    expect(upAcross([1, 0, 0])).toEqual([0, 1, 0]);
    expect(upAcross(CAMERA_STANDS.game.look)).toEqual([0, 1, 0]);
  });
});
