// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import type { Announcement, Notice } from "@/lib/tauri";
import { mockInvoke } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/utils";

import { useHomeStore } from "../../state";
import { useHomeUnread } from "../useHomeUnread";

function createWrapper() {
  const queryClient = createTestQueryClient();
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

const NOTICE: Notice = {
  id: "2026-09-patch-26-9",
  severity: "warning",
  title: "Patch 26.9: the patcher takes longer to hook",
  url: null,
  publishedAt: "2026-09-01T12:00:00Z",
};

const POST: Announcement = {
  id: "tag:github.com,2008:10174672",
  title: "[IMPORTANT] Patch 26.9 - Patcher Issues FAQ",
  url: "https://github.com/orgs/LeagueToolkit/discussions/220",
  publishedAt: "2026-06-01T05:44:14+00:00",
};

/** What the backend answers with, per command, for one case. */
function answer(feeds: { notices?: Notice[]; posts?: Announcement[] }) {
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === "get_app_info") {
      return Promise.resolve({
        ok: true,
        value: {
          name: "LTK Manager",
          version: "1.15.4",
          logFilePath: null,
          os: "windows",
          arch: "x64",
        },
      });
    }
    if (cmd === "list_notices") return Promise.resolve({ ok: true, value: feeds.notices ?? [] });
    if (cmd === "list_announcements") {
      return Promise.resolve({ ok: true, value: feeds.posts ?? [] });
    }
    return Promise.resolve({ ok: true, value: null });
  });
}

describe("useHomeUnread", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    useHomeStore.setState({ seenVersion: null, seenPostAt: null, dismissedNoticeIds: [] });
  });

  it("lights for a version the reader has not opened Home on", async () => {
    answer({});
    useHomeStore.setState({ seenVersion: "1.15.3" });

    const { result } = renderHook(() => useHomeUnread(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current).toBe(true));
  });

  it("clears once Home has been opened on the installed version", async () => {
    answer({});
    useHomeStore.setState({ seenVersion: "1.15.3" });
    const { result } = renderHook(() => useHomeUnread(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current).toBe(true));

    act(() => useHomeStore.getState().markVersionSeen("1.15.4"));

    await waitFor(() => expect(result.current).toBe(false));
  });

  it("stays lit for a notice until it is dismissed", async () => {
    answer({ notices: [NOTICE] });
    useHomeStore.setState({ seenVersion: "1.15.4" });
    const { result } = renderHook(() => useHomeUnread(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current).toBe(true));

    act(() => useHomeStore.getState().dismissNotice(NOTICE.id));

    await waitFor(() => expect(result.current).toBe(false));
  });

  it("lights for a post newer than the mark, and clears when the mark moves", async () => {
    answer({ posts: [POST] });
    useHomeStore.setState({ seenVersion: "1.15.4", seenPostAt: "2026-05-15T10:00:00Z" });
    const { result } = renderHook(() => useHomeUnread(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current).toBe(true));

    act(() => useHomeStore.getState().markPostSeen(POST.publishedAt!));

    await waitFor(() => expect(result.current).toBe(false));
  });
});
