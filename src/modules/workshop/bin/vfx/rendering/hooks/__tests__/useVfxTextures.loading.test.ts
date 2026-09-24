// @vitest-environment happy-dom

import { act, cleanup, renderHook } from "@testing-library/react";
import { Texture, TextureLoader } from "three";
import { afterEach, expect, it, vi } from "vitest";

import type { EmitterModel } from "../../../engine/model/model";
import type { DrawnEmitter } from "../../utils/definitions";
import { useVfxTextures } from "../useVfxTextures";

vi.mock("../../../../../preview/utils/assetRef", () => ({
  previewUrl: (asset: { pathHash: string }, width?: number) =>
    `https://asset.test/${asset.pathHash}?w=${width}`,
}));

function named(pathHash: string) {
  return { path: `${pathHash}.dds`, asset: { kind: "gameChunk", wad: "test", pathHash } };
}

function emitterNaming(base: string, mult: string, color: string): EmitterModel {
  return {
    texture: named(base),
    multTexture: named(mult),
    colorTexture: named(color),
    palette: null,
    erosion: null,
    distortion: null,
    reflection: null,
  } as unknown as EmitterModel;
}

const drawn = [
  { key: "emitter", emitter: emitterNaming("base", "mult", "color") },
] as DrawnEmitter[];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("limits small previews to two texture requests and disposes late arrivals after cancellation", async () => {
  const pending: ((texture: Texture<HTMLImageElement>) => void)[] = [];
  const load = vi.spyOn(TextureLoader.prototype, "load").mockImplementation((_url, onLoad) => {
    pending.push(onLoad!);
    return new Texture<HTMLImageElement>();
  });
  const { unmount } = renderHook(() => useVfxTextures(drawn, undefined, 128));
  expect(load).toHaveBeenCalledTimes(2);
  expect(load.mock.calls[0]![0]).toContain("w=128");

  const landed = new Texture<HTMLImageElement>();
  const disposed = vi.spyOn(landed, "dispose");
  await act(async () => pending[0]!(landed));
  expect(load).toHaveBeenCalledTimes(3);

  unmount();
  expect(disposed).toHaveBeenCalledOnce();
  const late = new Texture<HTMLImageElement>();
  const lateDisposed = vi.spyOn(late, "dispose");
  await act(async () => pending[1]!(late));
  expect(lateDisposed).toHaveBeenCalledOnce();
  expect(load).toHaveBeenCalledTimes(3);
});

it("does not start queued texture work after its preview is removed", async () => {
  const pending: ((texture: Texture<HTMLImageElement>) => void)[] = [];
  const load = vi.spyOn(TextureLoader.prototype, "load").mockImplementation((_url, onLoad) => {
    pending.push(onLoad!);
    return new Texture<HTMLImageElement>();
  });
  const { unmount } = renderHook(() => useVfxTextures(drawn, undefined, 128));
  unmount();
  await act(async () => pending[0]!(new Texture<HTMLImageElement>()));
  expect(load).toHaveBeenCalledTimes(2);
});

it("loads a url once for every slot and emitter naming it", async () => {
  const pending: ((texture: Texture<HTMLImageElement>) => void)[] = [];
  const load = vi.spyOn(TextureLoader.prototype, "load").mockImplementation((_url, onLoad) => {
    pending.push(onLoad!);
    return new Texture<HTMLImageElement>();
  });
  const shared = [
    { key: "0", emitter: emitterNaming("spark", "spark", "spark") },
    { key: "1", emitter: emitterNaming("spark", "spark", "spark") },
  ] as DrawnEmitter[];
  const { result } = renderHook(() => useVfxTextures(shared));
  expect(load).toHaveBeenCalledOnce();

  const spark = new Texture<HTMLImageElement>();
  await act(async () => pending[0]!(spark));

  expect(result.current.get("0")).toMatchObject({ base: spark, mult: spark, color: spark });
  expect(result.current.get("1")).toMatchObject({ base: spark, mult: spark, color: spark });
});

it("keeps every texture across an edit that moves no asset", async () => {
  const pending: ((texture: Texture<HTMLImageElement>) => void)[] = [];
  const load = vi.spyOn(TextureLoader.prototype, "load").mockImplementation((_url, onLoad) => {
    pending.push(onLoad!);
    return new Texture<HTMLImageElement>();
  });
  const { result, rerender } = renderHook(({ definitions }) => useVfxTextures(definitions), {
    initialProps: { definitions: drawn },
  });
  await act(async () => {
    for (const land of pending) land(new Texture<HTMLImageElement>());
  });
  const loaded = result.current.get("emitter");

  const edited = [
    { key: "emitter", emitter: emitterNaming("base", "mult", "color") },
  ] as DrawnEmitter[];
  rerender({ definitions: edited });

  expect(load).toHaveBeenCalledTimes(3);
  expect(result.current.get("emitter")).toBe(loaded);
});
