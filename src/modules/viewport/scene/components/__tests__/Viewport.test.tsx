// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { type ReactNode, useEffect, useLayoutEffect, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { ContentVisibilityContext } from "@/hooks";
import { createTestQueryClient } from "@/test/utils";

import { Viewport } from "../Viewport";

const renderer = {
  frameloop: "always",
  internal: { frames: 1 },
  gl: {},
  get: () => renderer,
  setFrameloop: (mode: string) => {
    renderer.frameloop = mode;
  },
};
const mounted = vi.fn();
const disposed = vi.fn();
let measure: (element: { clientWidth: number; clientHeight: number }) => void;
vi.mock("@/hooks", async (original) => ({
  ...(await original<typeof import("@/hooks")>()),
  useResizeObserver: (callback: typeof measure) => {
    measure = callback;
    return () => undefined;
  },
}));
vi.mock("../../hooks/sceneColors", () => ({ useSceneColors: () => ({}) }));
vi.mock("@react-three/fiber", () => ({
  Canvas: ({
    frameloop,
    onCreated,
  }: {
    frameloop: string;
    children: ReactNode;
    onCreated: (root: typeof renderer) => void;
  }) => {
    const [created] = useState(() => onCreated);
    useLayoutEffect(() => {
      renderer.frameloop = frameloop;
    }, [frameloop]);
    useEffect(() => {
      mounted();
      created(renderer);
      return disposed;
    }, [created]);
    return <output data-testid="canvas">{frameloop}</output>;
  },
}));
vi.mock("../../../camera/components/SceneCamera", () => ({ SceneCamera: () => null }));
vi.mock("../Stage", () => ({ Stage: () => null }));
vi.mock("../Sun", () => ({ Sun: () => null }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("creates one renderer on first visibility and pauses it across hidden or zero-size states", () => {
  /* Viewport asks for a backdrop, and a query needs a client even to answer none. */
  const client = createTestQueryClient();
  const view = (visible: boolean) => (
    <QueryClientProvider client={client}>
      <ContentVisibilityContext value={visible}>
        <Viewport stage={false} textured={false} camera="orbit">
          {null}
        </Viewport>
      </ContentVisibilityContext>
    </QueryClientProvider>
  );
  const { rerender, unmount } = render(view(false));
  act(() => measure({ clientWidth: 800, clientHeight: 600 }));
  expect(mounted).not.toHaveBeenCalled();
  rerender(view(true));
  const canvas = screen.getByTestId("canvas");
  expect(canvas).toHaveTextContent("always");
  rerender(view(false));
  expect(canvas).toHaveTextContent("never");
  expect(renderer.internal.frames).toBe(0);
  act(() => measure({ clientWidth: 0, clientHeight: 0 }));
  rerender(view(true));
  expect(canvas).toHaveTextContent("never");
  act(() => measure({ clientWidth: 800, clientHeight: 600 }));
  expect(canvas).toHaveTextContent("always");
  expect(mounted).toHaveBeenCalledTimes(1);
  expect(disposed).not.toHaveBeenCalled();
  unmount();
  expect(disposed).toHaveBeenCalledTimes(1);
});

it("retains an idle preview renderer without spending frames between jobs", () => {
  const client = createTestQueryClient();
  const view = (active: boolean) => (
    <QueryClientProvider client={client}>
      <Viewport active={active} dpr={1} gizmo={false} stage={false} textured={false} camera="orbit">
        {null}
      </Viewport>
    </QueryClientProvider>
  );
  const { rerender } = render(view(false));
  act(() => measure({ clientWidth: 192, clientHeight: 192 }));
  expect(mounted).not.toHaveBeenCalled();

  rerender(view(true));
  expect(screen.getByTestId("canvas")).toHaveTextContent("always");
  rerender(view(false));
  expect(screen.getByTestId("canvas")).toHaveTextContent("never");
  rerender(view(true));
  expect(mounted).toHaveBeenCalledTimes(1);
  expect(disposed).not.toHaveBeenCalled();
});
