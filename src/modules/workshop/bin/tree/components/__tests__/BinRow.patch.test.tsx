// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ContextMenu, ToastProvider } from "@/components";
import type { BinRow, WorkshopProject } from "@/lib/tauri";
import { mockInvoke } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/utils";

import { ProjectProvider } from "../../../../projects/state/ProjectContext";
import {
  type LinkTargets,
  LinkTargetsContext,
  NO_LINK_TARGETS,
  ObjectNameContext,
} from "../../../links/hooks/useLinkTargets";
import { rowKey, type RowLine } from "../../utils/binRows";
import { BinContextMenu } from "../BinContextMenu";
import { BinRowLine } from "../BinRow";

const MINIMAP = "ClientStates/Gameplay/UX/LoL/LoLMinimap/UIBase/Minimap/MinimapFrame";
const ENTRY = "0x4a47c414";

const PROJECT: WorkshopProject = {
  path: "C:/mods/hud",
  name: "hud",
  displayName: "HUD",
  version: "1.0.0",
  description: "",
  authors: [],
  tags: [],
  champions: [],
  maps: [],
  layers: [],
  thumbnailPath: null,
  lastModified: "2026-09-17T10:00:00Z",
  location: "workshop",
  lastOpened: null,
  id: "id-hud",
};

const TARGET: BinRow = {
  entry: ENTRY,
  path: "#",
  label: "",
  node: "target",
  name: MINIMAP,
  unnamed: false,
  kind: null,
  value: { type: "records", len: 2 },
  declared: null,
};

const RECORD: BinRow = {
  entry: ENTRY,
  path: "#1",
  label: "Position.UIRect",
  node: "record",
  name: "Position.UIRect",
  unnamed: false,
  kind: "embed",
  value: { type: "struct", classHash: "0x0a5d0595", class: "UiElementRect", len: 4 },
  declared: null,
};

function line(row: BinRow, depth = 0): RowLine {
  return {
    kind: "row",
    key: rowKey(row),
    row,
    depth,
    expanded: false,
    loading: false,
    owner: null,
    parent: null,
    index: 0,
  };
}

/** The index as it answers with `MINIMAP` declared in `UIBase`, or with nothing declared. */
function links(declared: boolean): LinkTargets {
  return {
    ...NO_LINK_TARGETS,
    index: { status: "ready" },
    declared: new Map(
      declared
        ? [
            [
              ENTRY,
              {
                path: MINIMAP,
                declarations: [
                  {
                    asset: { kind: "gameChunk", wad: "UI.wad.client", pathHash: "00aa" },
                    file: "clientstates/gameplay/ux/lol/lolminimap/uibase",
                    classHash: "0x0a5d0595",
                    class: "UiElementGroupData",
                  },
                ],
              },
            ],
          ]
        : [],
    ),
  };
}

function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => createTestQueryClient());
  return (
    <QueryClientProvider client={client}>
      <ProjectProvider project={PROJECT}>
        <ToastProvider>{children}</ToastProvider>
      </ProjectProvider>
    </QueryClientProvider>
  );
}

function renderRow(row: BinRow, declared: boolean) {
  const drawn = line(row);
  render(
    <ObjectNameContext value={(entry) => (entry === ENTRY ? MINIMAP : entry)}>
      <LinkTargetsContext value={links(declared)}>
        <ContextMenu.Root>
          <ContextMenu.Trigger>
            <BinRowLine line={drawn} focused={false} onToggle={() => {}} />
          </ContextMenu.Trigger>
          <BinContextMenu
            line={drawn}
            objectName={(entry) => (entry === ENTRY ? MINIMAP : entry)}
          />
        </ContextMenu.Root>
      </LinkTargetsContext>
    </ObjectNameContext>,
    { wrapper: Providers },
  );
}

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockImplementation((command: string) =>
    Promise.reject(new Error(`unexpected command ${command}`)),
  );
});

describe("a patch target row", () => {
  it("draws the object it patches and how many records it takes, with no tag", () => {
    renderRow(TARGET, true);

    expect(screen.getByText(MINIMAP)).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByRole("treeitem")).toHaveAttribute("aria-expanded", "false");
  });

  it("offers to open the object where the index declares it", async () => {
    renderRow(TARGET, true);
    const user = userEvent.setup();

    expect(screen.getByRole("button", { name: "Open object" })).toBeInTheDocument();
    await user.pointer({ keys: "[MouseRight]", target: screen.getByText(MINIMAP) });
    expect(await screen.findByRole("menuitem", { name: "Open object" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Open object beside" })).toBeInTheDocument();
  });

  it("offers no open where nothing declares the object", async () => {
    renderRow(TARGET, false);
    const user = userEvent.setup();

    expect(screen.queryByRole("button", { name: "Open object" })).toBeNull();
    await user.pointer({ keys: "[MouseRight]", target: screen.getByText(MINIMAP) });
    expect(await screen.findByRole("menuitem", { name: "Copy path" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Open object" })).toBeNull();
  });

  it("copies the object's path as its path", async () => {
    renderRow(TARGET, true);
    const writeText = vi.fn(() => Promise.resolve());
    const user = userEvent.setup({ writeToClipboard: false });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    await user.pointer({ keys: "[MouseRight]", target: screen.getByText(MINIMAP) });
    await user.click(await screen.findByRole("menuitem", { name: "Copy path" }));

    expect(writeText).toHaveBeenCalledWith(MINIMAP);
  });
});

describe("a patch record row", () => {
  it("draws the record's path, its kind and its value", () => {
    renderRow(RECORD, true);

    expect(screen.getByText("Position.UIRect")).toBeInTheDocument();
    expect(screen.getByText("embed")).toBeInTheDocument();
    expect(screen.getByText("UiElementRect")).toBeInTheDocument();
  });

  it("copies the object's path and the record's path joined on a colon", async () => {
    renderRow(RECORD, true);
    const writeText = vi.fn(() => Promise.resolve());
    const user = userEvent.setup({ writeToClipboard: false });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    await user.pointer({ keys: "[MouseRight]", target: screen.getByText("Position.UIRect") });
    expect(screen.queryByRole("menuitem", { name: "Open object" })).toBeNull();
    await user.click(await screen.findByRole("menuitem", { name: "Copy path" }));

    expect(writeText).toHaveBeenCalledWith(`${MINIMAP}:Position.UIRect`);
  });
});
