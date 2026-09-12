// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toastManager } from "@/components";
import type { IgnoreRules, WorkshopProject } from "@/lib/tauri";
import { createTestQueryClient } from "@/test/utils";

import { ProjectProvider } from "../../components/ProjectContext";
import { IGNORE_RULES_DOCUMENT_ID } from "../../documents";
import { useWorkshopEditorStore } from "../../state";
import { useIgnoreRowActions } from "../useIgnoreRowActions";

const PROJECT: WorkshopProject = {
  path: "X:/mods/my-mod",
  name: "my-mod",
  displayName: "My Mod",
  version: "1.0.0",
  description: "",
  authors: [],
  tags: [],
  champions: [],
  maps: [],
  layers: [],
  thumbnailPath: null,
  lastModified: "2026-08-21T21:14:02Z",
};

/** The file on disk, which the mocked commands read and write. */
let file = "";

function rules(text: string): IgnoreRules {
  return { path: `${PROJECT.path}/.modignore`, text, missingRecommended: [] };
}

vi.mock("@/lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tauri")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      ignoreRules: {
        read: () => Promise.resolve({ ok: true as const, value: rules(file) }),
        save: (_path: string, _at: string | null, text: string) => {
          file = text;
          return Promise.resolve({ ok: true as const, value: rules(text) });
        },
      },
    },
  };
});

function wrapper({ children }: { children: ReactNode }) {
  const client = createTestQueryClient();
  return (
    <QueryClientProvider client={client}>
      <ProjectProvider project={PROJECT}>{children}</ProjectProvider>
    </QueryClientProvider>
  );
}

function actions() {
  return renderHook(() => useIgnoreRowActions(), { wrapper }).result;
}

/** The toasts raised since the last reset, newest last. */
const raised: { title?: ReactNode; description?: ReactNode }[] = [];
let undoToast: (() => void) | undefined;

beforeEach(() => {
  file = "# sources\n*.psd\n";
  raised.length = 0;
  undoToast = undefined;
  useWorkshopEditorStore.setState({ byProject: {} });

  vi.spyOn(toastManager, "add").mockImplementation((toast) => {
    raised.push({ title: toast.title, description: toast.description });
    undoToast = toast.data?.actions?.find((action) => action.label === "Undo")?.onClick;
    return "toast";
  });
});

describe("useIgnoreRowActions", () => {
  it("writes the line under the rules and reads it back in the toast", async () => {
    const result = actions();

    await act(async () => {
      await result.current.ignore("/base/textures/skin0_src.psd", "file");
    });

    expect(file).toBe("# sources\n*.psd\n/base/textures/skin0_src.psd\n");
    expect(raised.at(-1)?.title).toBe("/base/textures/skin0_src.psd");
    expect(raised.at(-1)?.description).toBe("This file is left out of packages.");
  });

  it("takes the line back out when the toast's Undo is used", async () => {
    const result = actions();

    await act(async () => {
      await result.current.ignore("*.tex", "extension");
    });
    expect(file).toBe("# sources\n*.psd\n*.tex\n");

    await act(async () => undoToast?.());
    await waitFor(() => expect(file).toBe("# sources\n*.psd\n"));
  });

  it("deletes the row's own line when it stops ignoring", async () => {
    file = "*.psd\n/base/splash.psd\n";
    const result = actions();

    await act(async () => {
      await result.current.stopIgnoring("/base/splash.psd");
    });

    expect(file).toBe("*.psd\n");
  });

  it("opens the root rules on the line a broader pattern sits on", () => {
    const result = actions();

    act(() => {
      result.current.openRules({ pattern: "*.psd", source: ".modignore", line: 2 });
    });

    const editor = useWorkshopEditorStore.getState().byProject[PROJECT.path];
    expect(editor?.documents[IGNORE_RULES_DOCUMENT_ID]).toBeDefined();
    expect(editor?.revealIgnoreLine).toMatchObject({
      documentId: IGNORE_RULES_DOCUMENT_ID,
      line: 2,
    });
  });

  it("opens a nested file as its own document", () => {
    const result = actions();

    act(() => {
      result.current.openRules({
        pattern: "*.png",
        source: "content/base/.modignore",
        line: 1,
      });
    });

    const editor = useWorkshopEditorStore.getState().byProject[PROJECT.path];
    const id = `${IGNORE_RULES_DOCUMENT_ID}:content/base/.modignore`;
    expect(editor?.documents[id]).toMatchObject({ at: "content/base/.modignore" });
    expect(editor?.revealIgnoreLine).toMatchObject({ documentId: id, line: 1 });
  });
});
