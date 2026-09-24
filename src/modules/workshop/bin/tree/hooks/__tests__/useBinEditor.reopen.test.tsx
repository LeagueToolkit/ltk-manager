// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BinDocumentId } from "@/lib/tauri";
import { editCall, landed, sentEdit } from "@/test/binEdit";
import { mockInvoke } from "@/test/mocks/tauri";

import { assetKey } from "../../../../preview/utils/assetRef";
import { forgetBinSave, isQueuedThrough } from "../../../../state";
import { registerReopen } from "../../../documents/hooks/useDocumentCall";
import { ASSET, DOCUMENT, NO_FOCUS, providers } from "../../components/__tests__/binEditFixtures";
import type { AddSuggestion } from "../../utils/addProperty";
import type { AddLine } from "../../utils/binRows";
import { useBinEditor } from "../useBinEdit";

const FRESH = 9 as BinDocumentId;
const NOT_OPEN = { ok: false, error: { code: "BIN_NOT_OPEN" } };

let unregister = () => {};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  mockInvoke.mockReset();
});

afterEach(() => {
  unregister();
  forgetBinSave(assetKey(ASSET));
  vi.useRealTimers();
});

/** A backend that has evicted `DOCUMENT` and answers every edit on `FRESH`. */
function evicted() {
  mockInvoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
    if (command === "bin_edit" && args?.document === DOCUMENT) return Promise.resolve(NOT_OPEN);
    if (sentEdit(command, args, "dependency")) return landed({ kind: "index", index: 2 });
    if (sentEdit(command, args, "addProperty")) return landed();
    return Promise.resolve({ ok: true, value: null });
  });
}

describe("useBinEditor on an evicted document", () => {
  it("reopens and sends a dependency insert again, queueing the save on the fresh id", async () => {
    evicted();
    const reopen = vi.fn(() => Promise.resolve(FRESH));
    unregister = registerReopen(DOCUMENT, reopen);
    const { result } = renderHook(() => useBinEditor(DOCUMENT, ASSET, true, NO_FOCUS), {
      wrapper: providers(),
    });

    let added: unknown = null;
    await act(async () => {
      added = await result.current?.dependencies.add("DATA/Characters/Teemo/Teemo.bin");
    });

    expect(added).toEqual({ ok: true, value: 2 });
    expect(reopen).toHaveBeenCalledOnce();
    expect(mockInvoke).toHaveBeenLastCalledWith(
      ...editCall(FRESH, {
        kind: "dependency",
        edit: { kind: "insert", index: null, text: "DATA/Characters/Teemo/Teemo.bin" },
      }),
    );
    expect(isQueuedThrough(assetKey(ASSET), FRESH)).toBe(true);
  });

  it("reopens and sends an added property again on the fresh id", async () => {
    evicted();
    const reopen = vi.fn(() => Promise.resolve(FRESH));
    unregister = registerReopen(DOCUMENT, reopen);
    const { result } = renderHook(() => useBinEditor(DOCUMENT, ASSET, true, NO_FOCUS), {
      wrapper: providers(),
    });
    const line = { entry: "0x2a1f3c7d", path: "", key: "0x2a1f3c7d:add" } as AddLine;
    const suggestion: AddSuggestion = {
      kind: "custom",
      field: "scale",
      shape: { kind: "f32", key: null, value: null },
      class: null,
    };

    await act(async () => {
      await result.current?.add(line, suggestion);
    });

    expect(reopen).toHaveBeenCalledOnce();
    expect(mockInvoke).toHaveBeenLastCalledWith(
      "bin_edit",
      expect.objectContaining({
        document: FRESH,
        edit: expect.objectContaining({ kind: "addProperty" }),
      }),
    );
    expect(isQueuedThrough(assetKey(ASSET), FRESH)).toBe(true);
  });

  it("keeps the refusal where no reopen is registered", async () => {
    evicted();
    const { result } = renderHook(() => useBinEditor(DOCUMENT, ASSET, true, NO_FOCUS), {
      wrapper: providers(),
    });

    let added: unknown = null;
    await act(async () => {
      added = await result.current?.dependencies.add("DATA/Characters/Teemo/Teemo.bin");
    });

    expect(added).toEqual(NOT_OPEN);
    expect(isQueuedThrough(assetKey(ASSET), DOCUMENT)).toBe(false);
  });
});
