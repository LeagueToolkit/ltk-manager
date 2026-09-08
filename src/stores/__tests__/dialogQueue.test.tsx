// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";

import { useDialogQueueStore, useQueuedDialog } from "../dialogQueue";

describe("dialog queue store", () => {
  beforeEach(() => {
    useDialogQueueStore.setState({ current: null, claims: [] });
  });

  it("grants the screen to the only claim", () => {
    useDialogQueueStore.getState().request("update");

    expect(useDialogQueueStore.getState().current).toBe("update");
  });

  it("grants the screen by the order, whatever order the claims arrive in", () => {
    useDialogQueueStore.getState().request("update");
    useDialogQueueStore.getState().request("wad-scan-failed");

    expect(useDialogQueueStore.getState().current).toBe("wad-scan-failed");
  });

  it("hands the screen to the next claim when the holder releases", () => {
    useDialogQueueStore.getState().request("update");
    useDialogQueueStore.getState().request("mod-health");
    useDialogQueueStore.getState().release("mod-health");

    expect(useDialogQueueStore.getState().current).toBe("update");
  });

  it("keeps a waiting claim waiting rather than dropping it", () => {
    useDialogQueueStore.getState().request("update");
    useDialogQueueStore.getState().request("wad-scan-failed");

    expect(useDialogQueueStore.getState().claims).toContain("update");
  });

  it("counts one claim per dialog", () => {
    useDialogQueueStore.getState().request("update");
    useDialogQueueStore.getState().request("update");
    useDialogQueueStore.getState().release("update");

    expect(useDialogQueueStore.getState().current).toBeNull();
  });

  it("goes back to nothing showing once every claim is released", () => {
    useDialogQueueStore.getState().request("update");
    useDialogQueueStore.getState().release("update");

    expect(useDialogQueueStore.getState().current).toBeNull();
  });
});

describe("useQueuedDialog", () => {
  beforeEach(() => {
    useDialogQueueStore.setState({ current: null, claims: [] });
  });

  it("shows a dialog nothing outranks", () => {
    const { result } = renderHook(() => useQueuedDialog("update", true));

    expect(result.current).toBe(true);
  });

  it("holds a dialog back while something outranks it", () => {
    act(() => useDialogQueueStore.getState().request("wad-scan-failed"));
    const { result } = renderHook(() => useQueuedDialog("update", true));

    expect(result.current).toBe(false);
  });

  it("raises the held dialog once the one above it releases", () => {
    act(() => useDialogQueueStore.getState().request("wad-scan-failed"));
    const { result } = renderHook(() => useQueuedDialog("update", true));

    act(() => useDialogQueueStore.getState().release("wad-scan-failed"));

    expect(result.current).toBe(true);
  });

  it("claims nothing while the dialog has nothing to say", () => {
    renderHook(() => useQueuedDialog("update", false));

    expect(useDialogQueueStore.getState().claims).toEqual([]);
  });

  it("releases the screen when the dialog stops wanting it", () => {
    const { rerender } = renderHook(({ wanted }) => useQueuedDialog("update", wanted), {
      initialProps: { wanted: true },
    });

    rerender({ wanted: false });

    expect(useDialogQueueStore.getState().current).toBeNull();
  });

  it("releases the screen when the dialog unmounts", () => {
    const { unmount } = renderHook(() => useQueuedDialog("update", true));

    unmount();

    expect(useDialogQueueStore.getState().current).toBeNull();
  });
});
