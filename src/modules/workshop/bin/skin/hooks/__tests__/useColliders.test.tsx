// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AssetRef, BinDocumentId, ColliderShapes, SkinModel } from "@/lib/tauri";
import { type ColliderFile, viewportQueries } from "@/modules/viewport";
import { commandNames } from "@/test/commandNames";
import { mockInvoke } from "@/test/mocks/tauri";

import { chain, skin } from "../../utils/__tests__/fixtures";
import { shapesOf } from "../../utils/colliders";
import type { WireChain } from "../../utils/dynamicsModel";
import { useColliderEdit, useColliderFiles } from "../useColliders";

const { send, toast } = vi.hoisted(() => ({ send: vi.fn(), toast: { failure: vi.fn() } }));

vi.mock("../useDynamicsEdit", () => ({ useDynamicsEdit: () => send }));
vi.mock("@/components", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components")>()),
  useToast: () => toast,
}));

const DOCUMENT = 1 as BinDocumentId;
const ENTRY = "0x12345678";
const SKELETON = "ASSETS/Characters/Ahri/Skins/Base/Ahri.skl";
const FILE = "ASSETS/Characters/Ahri/Skins/Base/Ahri.colliders";
const LAYER: AssetRef = { kind: "layer", project: "project", layer: "base", path: FILE };
const GAME: AssetRef = { kind: "gameChunk", wad: "Champions/Ahri.wad.client", pathHash: "01" };

/** A file of one sphere, told from another by its radius. */
function sphere(radius: number): ColliderFile {
  return { spheres: [{ joint: "Root", centre: [0, 0, 0], radius }], capsules: [] };
}

/** A skin of one chain, which names the file `asset` holds, or no file for null. */
function skinOf(asset: AssetRef | null): SkinModel {
  const held: WireChain = {
    ...chain([]),
    colliderFile: asset === null ? null : { path: FILE, asset },
  };
  return skin({ skeleton: { path: SKELETON, asset: null }, poseModifiers: [held] });
}

function chainOf(model: SkinModel): WireChain {
  return model.poseModifiers[0] as WireChain;
}

/** The saves the backend was sent and has not answered, oldest first. */
interface SentSave {
  readonly shapes: ColliderShapes;
  readonly answer: (result: unknown) => void;
}

let sent: SentSave[] = [];

beforeEach(() => {
  sent = [];
  send.mockReset();
  toast.failure.mockReset();
  mockInvoke.mockReset();
  mockInvoke.mockImplementation((command: string, args?: { shapes: ColliderShapes }) => {
    if (command !== commandNames.preview.saveSkinColliders || args === undefined) {
      return Promise.resolve({ ok: true, value: null });
    }

    return new Promise((answer) => {
      sent.push({ shapes: args.shapes, answer });
    });
  });
});

function mount(model: SkinModel, held: readonly (readonly [AssetRef, ColliderFile])[] = []) {
  const client = new QueryClient();
  for (const [asset, file] of held) {
    client.setQueryData(viewportQueries.colliders(asset).queryKey, file);
  }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    ({ shown }: { shown: SkinModel }) => ({
      files: useColliderFiles(shown, ENTRY),
      edit: useColliderEdit(DOCUMENT, ENTRY, shown),
    }),
    { wrapper, initialProps: { shown: model } },
  );

  const shapes = () => hook.result.current.files.get(chainOf(model).path);
  /* A commit shows before any save answers. */
  const commit = async (file: ColliderFile) => {
    act(() => hook.result.current.edit?.commit(chainOf(model), file));
    await waitFor(() => expect(shapes()).toEqual(file));
  };
  return { client, shapes, commit, rerender: hook.rerender };
}

async function answer(at: number, result: unknown) {
  await act(async () => {
    sent[at].answer(result);
    await Promise.resolve();
  });
}

describe("useColliderEdit", () => {
  it("shows a commit at once and returns to what the file holds when the save fails", async () => {
    const model = skinOf(LAYER);
    const { shapes, commit } = mount(model, [[LAYER, sphere(1)]]);
    expect(shapes()).toEqual(sphere(1));

    await commit(sphere(2));
    const refusal = { code: "PREVIEW", detail: "Disk full" };
    await answer(0, { ok: false, error: refusal });

    await waitFor(() => expect(shapes()).toEqual(sphere(1)));
    expect(toast.failure).toHaveBeenCalledWith("The collider file was not saved", refusal);
  });

  it("leaves the read of a shipped file alone when its save lands in the layer", async () => {
    const model = skinOf(GAME);
    const { client, shapes, commit, rerender } = mount(model, [[GAME, sphere(1)]]);
    const invalidate = vi.spyOn(client, "invalidateQueries");

    await commit(sphere(2));
    await answer(0, { ok: true, value: LAYER });

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["skin", DOCUMENT, ENTRY] }),
    );
    expect(client.getQueryData(viewportQueries.colliders(GAME).queryKey)).toEqual(sphere(1));
    expect(client.getQueryData(viewportQueries.colliders(LAYER).queryKey)).toEqual(sphere(2));
    expect(shapes()).toEqual(sphere(2));

    rerender({ shown: skinOf(LAYER) });
    await waitFor(() => expect(shapes()).toEqual(sphere(2)));
  });

  it("sends the saves of one file one at a time, in the order of their commits", async () => {
    const { shapes, commit } = mount(skinOf(LAYER), [[LAYER, sphere(1)]]);

    await commit(sphere(2));
    await commit(sphere(3));
    expect(sent.map((save) => save.shapes)).toEqual([shapesOf(sphere(2))]);

    await answer(0, { ok: true, value: LAYER });
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1].shapes).toEqual(shapesOf(sphere(3)));
    expect(shapes()).toEqual(sphere(3));

    await answer(1, { ok: true, value: LAYER });
    await waitFor(() => expect(shapes()).toEqual(sphere(3)));
  });

  it("shows the shapes of a chain that names no file yet, and names the file once", async () => {
    const { client, shapes, commit } = mount(skinOf(null));
    const invalidate = vi.spyOn(client, "invalidateQueries");
    expect(shapes()).toBeUndefined();

    await commit(sphere(1));
    await commit(sphere(2));

    await answer(0, { ok: true, value: LAYER });
    await waitFor(() => expect(sent).toHaveLength(2));
    await answer(1, { ok: true, value: LAYER });

    /* The second save finds the file named, and asks for the skin again in place of naming it. */
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["skin", DOCUMENT, ENTRY] }),
    );
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0].at(-1)).toEqual({
      type: "setLeaf",
      path: expect.any(String),
      value: { type: "string", value: `ASSETS/Characters/Ahri/Skins/Base/Ahri.${ENTRY}.colliders` },
    });
    expect(shapes()).toEqual(sphere(2));
  });
});
