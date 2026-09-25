// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ContentTree, GameSearchResult, WorkshopProject } from "@/lib/tauri";
import { mockInvoke } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/utils";

import { ProjectProvider } from "../../../../projects/state/ProjectContext";
import type { PathField } from "../../utils/pathField";
import { PathInput } from "../PathInput";

const PROJECT: WorkshopProject = {
  path: "C:/mods/glow",
  name: "glow",
  displayName: "Glow",
  version: "1.0.0",
  description: "",
  authors: [],
  tags: [],
  champions: [],
  maps: [],
  layers: [],
  thumbnailPath: null,
  lastModified: "2026-09-24T12:00:00Z",
  location: "workshop",
  lastOpened: null,
  id: "id-glow",
};

const TREE: ContentTree = {
  layers: [
    {
      name: "base",
      fileCount: 1,
      totalSizeBytes: 0n,
      ignoredDirectories: [],
      entries: [
        {
          relativePath: "Ahri.wad.client/ASSETS/Mod/glow_ring.dds",
          sizeBytes: 64n,
          kind: "texture_dds",
          objects: [],
          ignoredBy: null,
        },
      ],
    },
  ],
};

const SEARCH: GameSearchResult = {
  hits: [
    {
      pathHash: "00aa00aa00aa00aa",
      name: "glow_trail.dds",
      path: "assets/shared/particles",
      wad: "Shared.wad.client",
      band: 0,
      score: 1,
      nameRanges: [],
      pathRanges: [],
    },
  ],
  total: 3,
  superseded: false,
  unnamed: false,
};

const TEXTURE: PathField = { extensions: ["dds", "tex"], enterPicks: true };

function mount(value = "", field = TEXTURE) {
  const onCommit = vi.fn();
  const onEnter = vi.fn();
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <ProjectProvider project={PROJECT}>
        <PathInput
          value={value}
          field={field}
          aria-label="Edit value"
          invalid={false}
          autoFocus={false}
          onCommit={onCommit}
          onEnter={onEnter}
        />
      </ProjectProvider>
    </QueryClientProvider>,
  );

  return { input: screen.getByRole("combobox", { name: "Edit value" }), onCommit, onEnter };
}

afterEach(cleanup);
beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockImplementation((command: string) => {
    if (command === "get_project_content_tree") return Promise.resolve({ ok: true, value: TREE });
    if (command === "search_game_paths") return Promise.resolve({ ok: true, value: SEARCH });
    if (command === "read_game_dir") {
      return Promise.resolve({
        ok: true,
        value: {
          dirs: [],
          files: [
            {
              pathHash: "00bb00bb00bb00bb",
              path: "assets/characters/ahri/ahri_w.dds",
              sizeBytes: 64n,
              wad: "Champions/Ahri.wad.client",
            },
          ],
        },
      });
    }
    return Promise.reject(new Error(`unexpected command ${command}`));
  });
});

describe("PathInput", () => {
  it("lists the project's matches and the game's for typed terms", async () => {
    const { input } = mount();

    await userEvent.type(input, "glow");

    expect(await screen.findByRole("option", { name: /glow_ring\.dds/ })).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: /glow_trail\.dds/ })).toBeInTheDocument();
    expect(screen.getByText("2 more, keep typing")).toBeInTheDocument();
    expect(mockInvoke).toHaveBeenCalledWith("search_game_paths", {
      query: "glow",
      preference: { extensions: ["dds", "tex"], archive: null },
    });
  });

  it("takes the top suggestion on Enter while the draft is search terms", async () => {
    const { input, onCommit, onEnter } = mount();

    await userEvent.type(input, "glow");
    await screen.findByRole("option", { name: /glow_ring\.dds/ });
    await userEvent.keyboard("{Enter}");

    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith("ASSETS/Mod/glow_ring.dds");
    expect(onEnter).toHaveBeenCalledOnce();
  });

  it("writes a typed path as typed on Enter", async () => {
    const { input, onCommit } = mount();

    await userEvent.type(input, "assets/mod/new.dds");
    await userEvent.keyboard("{Enter}");

    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith("assets/mod/new.dds");
  });

  it("writes a clicked suggestion's path", async () => {
    const { input, onCommit, onEnter } = mount();

    await userEvent.type(input, "glow");
    await userEvent.click(await screen.findByRole("option", { name: /glow_trail\.dds/ }));

    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith("assets/shared/particles/glow_trail.dds");
    expect(onEnter).not.toHaveBeenCalled();
  });

  it("drops the draft on Escape", async () => {
    const { input, onCommit } = mount("ASSETS/Mod/glow_ring.dds");

    await userEvent.clear(input);
    await userEvent.type(input, "zzz{Escape}");

    expect(onCommit).not.toHaveBeenCalled();
  });

  it("opens on the current path's folder before anything is typed", async () => {
    const { input } = mount("ASSETS/Characters/Ahri/ahri_q.dds");

    await userEvent.click(input);

    expect(await screen.findByText("Same folder")).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: /ahri_w\.dds/ })).toBeInTheDocument();
    expect(mockInvoke).toHaveBeenCalledWith("read_game_dir", { path: "assets/characters/ahri" });
  });
});
