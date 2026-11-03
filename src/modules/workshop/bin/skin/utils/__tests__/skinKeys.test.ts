import { describe, expect, it } from "vitest";

import { SHIFT_FRAMES, SKIN_KEYS, type SkinKeyTarget, SOCKET_KEYS } from "../skinKeys";

function target(time: number, speed = 1) {
  const calls: { seek?: number; playing?: boolean; speed?: number; fits: number } = { fits: 0 };
  const keys: SkinKeyTarget = {
    clock: {
      time,
      seek: (next) => {
        calls.seek = next;
      },
      restart: () => {
        calls.seek = 0;
      },
    },
    playing: true,
    setPlaying: (playing) => {
      calls.playing = playing;
    },
    speed,
    setSpeed: (next) => {
      calls.speed = next;
    },
    fit: () => {
      calls.fits += 1;
    },
  };

  return { keys, calls };
}

describe("SOCKET_KEYS", () => {
  it("drives the socket gizmo and does nothing while none draws", () => {
    const pressed: string[] = [];
    const { keys } = target(0);
    const armed: SkinKeyTarget = {
      ...keys,
      socketGizmo: {
        move: () => pressed.push("move"),
        turn: () => pressed.push("turn"),
        toggleAxes: () => pressed.push("axes"),
      },
    };

    for (const key of Object.values(SOCKET_KEYS)) {
      key.run(armed);
      key.run(keys);
    }

    expect(pressed).toEqual(["move", "turn", "axes"]);
  });
});

describe("SKIN_KEYS", () => {
  it("shows the first chord of its registry command", () => {
    expect(SKIN_KEYS.play.shortcut).toBe("Space");
    expect(SKIN_KEYS.stepBackLong.shortcut).toBe("Shift+Left");
    expect(SOCKET_KEYS.turn.shortcut).toBe("E");
  });

  it("pauses and moves one frame on an arrow", () => {
    const { keys, calls } = target(1);

    SKIN_KEYS.stepForward.run(keys);

    expect(calls.playing).toBe(false);
    expect(calls.seek).toBeCloseTo(1 + 1 / 60);
  });

  it("moves six frames on Shift and an arrow", () => {
    const { keys, calls } = target(1);

    SKIN_KEYS.stepBackLong.run(keys);

    expect(SHIFT_FRAMES).toBe(6);
    expect(calls.seek).toBeCloseTo(1 - 6 / 60);
  });

  it("walks the speed detents on the brackets", () => {
    const { keys, calls } = target(0, 1);

    SKIN_KEYS.faster.run(keys);
    expect(calls.speed).toBe(1.5);

    SKIN_KEYS.slower.run(keys);
    expect(calls.speed).toBe(0.5);
  });
});
