// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";

import { useDialogQueue, useQueuedDialog } from "../dialogQueue";

describe("dialog queue store", () => {
  beforeEach(() => {
    useDialogQueue.setState({ current: null, claims: [] });
  });

  it("grants the screen to the only claim", () => {
    useDialogQueue.getState().request("update");

    expect(useDialogQueue.getState().current).toBe("update");
  });

  it("grants the screen by the order, whatever order the claims arrive in", () => {
    useDialogQueue.getState().request("update");
    useDialogQueue.getState().request("wad-scan-failed");

    expect(useDialogQueue.getState().current).toBe("wad-scan-failed");
  });

  it("hands the screen to the next claim when the holder releases", () => {
    useDialogQueue.getState().request("update");
    useDialogQueue.getState().request("mod-health");
    useDialogQueue.getState().release("mod-health");

    expect(useDialogQueue.getState().current).toBe("update");
  });

  it("keeps a waiting claim waiting rather than dropping it", () => {
    useDialogQueue.getState().request("update");
    useDialogQueue.getState().request("wad-scan-failed");

    expect(useDialogQueue.getState().claims).toContain("update");
  });

  it("counts one claim per dialog", () => {
    useDialogQueue.getState().request("update");
    useDialogQueue.getState().request("update");
    useDialogQueue.getState().release("update");

    expect(useDialogQueue.getState().current).toBeNull();
  });

  it("goes back to nothing showing once every claim is released", () => {
    useDialogQueue.getState().request("update");
    useDialogQueue.getState().release("update");

    expect(useDialogQueue.getState().current).toBeNull();
  });
});

describe("useQueuedDialog", () => {
  beforeEach(() => {
    useDialogQueue.setState({ current: null, claims: [] });
  });

  it("shows a dialog nothing outranks", () => {
    const { result } = renderHook(() => useQueuedDialog("update", true));

    expect(result.current).toBe(true);
  });

  it("holds a dialog back while something outranks it", () => {
    act(() => useDialogQueue.getState().request("wad-scan-failed"));
    const { result } = renderHook(() => useQueuedDialog("update", true));

    expect(result.current).toBe(false);
  });

  it("raises the held dialog once the one above it releases", () => {
    act(() => useDialogQueue.getState().request("wad-scan-failed"));
    const { result } = renderHook(() => useQueuedDialog("update", true));

    act(() => useDialogQueue.getState().release("wad-scan-failed"));

    expect(result.current).toBe(true);
  });

  it("claims nothing while the dialog has nothing to say", () => {
    renderHook(() => useQueuedDialog("update", false));

    expect(useDialogQueue.getState().claims).toEqual([]);
  });

  it("releases the screen when the dialog stops wanting it", () => {
    const { rerender } = renderHook(({ wanted }) => useQueuedDialog("update", wanted), {
      initialProps: { wanted: true },
    });

    rerender({ wanted: false });

    expect(useDialogQueue.getState().current).toBeNull();
  });

  it("releases the screen when the dialog unmounts", () => {
    const { unmount } = renderHook(() => useQueuedDialog("update", true));

    unmount();

    expect(useDialogQueue.getState().current).toBeNull();
  });
});
