import { describe, expect, it } from "vitest";

import { LINGER_TYPE } from "../enums";
import type { SystemModel } from "../model";
import { emptySystem, lingerTail, stopWaitSeconds } from "../systemModel";
import { emitterOf, flat } from "./emitterFixture";

describe("stopWaitSeconds", () => {
  it("caps emitterLinger at a complex emitter's lifetime plus ten, and a simple one's at ten", () => {
    expect(stopWaitSeconds(emitterOf(0, { emitterLinger: 30, lifetime: 1 }))).toBe(11);
    expect(stopWaitSeconds(emitterOf(0, { emitterLinger: 30, lifetime: null }))).toBe(30);
    expect(stopWaitSeconds(emitterOf(0, { emitterLinger: 30, simple: true }))).toBe(10);
  });

  it("waits no time for an emitter authoring no emitterLinger", () => {
    expect(stopWaitSeconds(emitterOf(0))).toBe(0);
  });
});

describe("lingerTail", () => {
  function systemOf(over: Partial<SystemModel>): SystemModel {
    return { ...emptySystem(null), ...over };
  }

  const lingering = {
    particleLifetime: flat(1),
    particleLinger: 0.5,
    lingerType: LINGER_TYPE.fixedLifetimeAfterEmitterDies,
  };

  it("adds the wait still owed at the stop to the linger", () => {
    const system = systemOf({ emitters: [emitterOf(0, { ...lingering, emitterLinger: 3 })] });

    expect(lingerTail(system, 1)).toBe(2.5);
    expect(lingerTail(system, 4)).toBe(0.5);
  });

  it("counts the build-up in the system's age at the stop", () => {
    const system = systemOf({
      emitters: [emitterOf(0, { ...lingering, emitterLinger: 3 })],
      buildUpTime: 2,
    });

    expect(lingerTail(system, 0.5)).toBe(1);
  });
});
