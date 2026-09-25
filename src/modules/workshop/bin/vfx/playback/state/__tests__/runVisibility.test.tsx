// @vitest-environment happy-dom

import { act, cleanup, render } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { ContentVisibilityContext } from "@/hooks";

import { readVfxSystem } from "../../../engine/parsing/readVfxSystem";
import { emitterOf, flat } from "../../../engine/simulation/__tests__/emitterFixture";
import { useVfxRun, VfxRunProvider, type VfxRun } from "../run";

const initialSystem = readVfxSystem({
  materials: [],
  entry: "0x1",
  name: null,
  classHash: "0x1",
  class: "VfxSystemDefinitionData",
  root: {
    type: "struct",
    classHash: "0x1",
    class: "VfxSystemDefinitionData",
    object: null,
    fields: [],
  },
});
let system = initialSystem;

vi.mock("../../../hooks/useVfxSystem", () => ({
  useVfxSystem: () => ({ system, error: null, pending: false }),
}));
afterEach(() => {
  cleanup();
  system = initialSystem;
  vi.unstubAllGlobals();
});

it.each([false, true])("refreshes an edited system with playing=%s", (playing) => {
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  system = { ...initialSystem, emitters: [emitterOf(0, { rate: flat(5) })] };
  let run: VfxRun;

  function Capture() {
    run = useVfxRun();
    return null;
  }

  const view = () => (
    <VfxRunProvider document={935} asset={null} entry="0x1">
      <Capture />
    </VfxRunProvider>
  );
  const { rerender } = render(view());
  act(() => {
    run!.setPlaying(playing);
    run!.seek(0.5);
  });

  const driver = run!.driver;
  const count = driver.pool.count;
  const seek = vi.spyOn(driver, "seek");
  system = { ...system, emitters: [emitterOf(0, { rate: flat(20) })] };
  rerender(view());

  expect(run!.driver).toBe(driver);
  expect(run!.playing).toBe(playing);
  expect(driver.phase).toBeCloseTo(0.5);

  if (playing) {
    expect(seek).not.toHaveBeenCalled();
    expect(driver.pool.count).toBe(count);
  } else {
    expect(seek).toHaveBeenCalledTimes(1);
    expect(seek.mock.calls[0][0]).toBeCloseTo(0.5);
    expect(driver.pool.count).toBeGreaterThan(count);
  }
});

it("pauses a hidden document's simulation and resumes without catching up hidden time", () => {
  const queued = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    queued.set(++id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (key: number) => queued.delete(key));
  let run: VfxRun;
  function Capture() {
    const current = useVfxRun();
    useEffect(() => {
      run = current;
    }, [current]);
    return null;
  }
  function tick(time: number) {
    act(() => {
      const callbacks = [...queued.values()];
      queued.clear();
      for (const callback of callbacks) callback(time);
    });
  }
  const view = (visible: boolean) => (
    <ContentVisibilityContext value={visible}>
      <VfxRunProvider document={934} asset={null} entry="0x1">
        <Capture />
      </VfxRunProvider>
    </ContentVisibilityContext>
  );
  const { rerender } = render(view(true));
  tick(0);
  tick(50);
  expect(run!.driver.phase).toBeCloseTo(0.05);
  const driver = run!.driver;
  rerender(view(false));
  expect(queued.size).toBe(0);
  tick(10000);
  expect(driver.phase).toBeCloseTo(0.05);
  rerender(view(true));
  tick(10000);
  tick(10050);
  expect(run!.driver).toBe(driver);
  expect(driver.phase).toBeCloseTo(0.1);
  expect(run!.playing).toBe(true);
});
