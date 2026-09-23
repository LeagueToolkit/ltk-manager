// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { WorkshopProject } from "@/lib/tauri";
import { createTestQueryClient } from "@/test/utils";

import { ProjectProvider } from "../../../projects/state/ProjectContext";
import type { ReferenceFileNode, ReferenceObjectNode } from "../../utils/referenceTree";
import { ReferencesTreeRow } from "../ReferencesTreeRow";

const PROJECT: WorkshopProject = {
  path: "C:/mods/skin",
  name: "skin",
  displayName: "Skin",
  version: "1.0.0",
  description: "",
  authors: [],
  tags: [],
  champions: [],
  maps: [],
  layers: [],
  thumbnailPath: null,
  lastModified: "2026-08-21T21:14:02Z",
  location: "workshop",
  lastOpened: null,
  id: "id-skin",
};

const OBJECT: ReferenceObjectNode = {
  type: "object",
  id: "chunk:0x2a1f3c7d",
  objectHash: "0x2a1f3c7d",
  path: "characters/aatrox/skins/skin0",
  name: "skin0",
  prefix: "characters/aatrox/skins",
  unnamed: false,
  classHash: "0x9b67e9f6",
  class: "SkinCharacterDataProperties",
  asset: { kind: "gameChunk", wad: "Champions/Aatrox.wad.client", pathHash: "00aa" },
  file: "data/characters/aatrox/skins/skin0.bin",
  property: null,
};

const FILE: ReferenceFileNode = {
  type: "file",
  id: "chunk",
  asset: OBJECT.asset,
  file: "data/characters/aatrox/skins/skin0.bin",
  children: [OBJECT, { ...OBJECT, id: "chunk:0x1", objectHash: "0x1", name: "resources" }],
};

function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => createTestQueryClient());
  return (
    <QueryClientProvider client={client}>
      <ProjectProvider project={PROJECT}>{children}</ProjectProvider>
    </QueryClientProvider>
  );
}

function renderRow(node: ReferenceFileNode | ReferenceObjectNode, isExpanded = true) {
  const onToggle = vi.fn();
  const onOpen = vi.fn();
  const onSelect = vi.fn();
  render(
    <Providers>
      <ReferencesTreeRow
        node={node}
        depth={node.type === "file" ? 0 : 1}
        isExpanded={isExpanded}
        isSelected={false}
        onToggle={onToggle}
        onSelect={onSelect}
        onOpen={onOpen}
        height={24}
        rowIndex={2}
        tabIndex={0}
      />
    </Providers>,
  );
  return { onToggle, onOpen, onSelect };
}

describe("ReferencesTreeRow", () => {
  it("draws a group as its file, where it sits, and how many objects it holds", async () => {
    const user = userEvent.setup();
    const { onToggle } = renderRow(FILE);

    const row = screen.getByRole("treeitem");
    expect(row).toHaveTextContent("data/characters/aatrox/skins/skin0.bin");
    expect(row).toHaveTextContent("Aatrox");
    expect(row).toHaveTextContent("2");
    expect(row).toHaveAttribute("aria-expanded", "true");

    await user.click(row);
    expect(onToggle).toHaveBeenCalledWith(FILE);
  });

  it("draws an object as its name over the path above it, with its class", () => {
    renderRow(OBJECT);

    const row = screen.getByRole("treeitem");
    expect(row).toHaveTextContent("skin0");
    expect(row).toHaveTextContent("characters/aatrox/skins");
    expect(row).toHaveTextContent("SkinCharacterDataProperties");
    /* The group above the row is the file, so no row repeats it. */
    expect(row).not.toHaveTextContent("skin0.bin");
  });

  it("draws a walk's row with the property path that holds the reference", () => {
    renderRow({ ...OBJECT, property: { path: "0000000a[2]", label: "mLinks[2]" } });

    const row = screen.getByRole("treeitem");
    expect(row).toHaveTextContent("mLinks[2]");
    expect(row).toHaveAttribute("title", "characters/aatrox/skins/skin0:mLinks[2]");
  });

  it("opens an object from its body, and beside it with Ctrl held", async () => {
    const user = userEvent.setup();
    const { onOpen, onToggle } = renderRow(OBJECT);

    await user.click(screen.getByText("skin0"));
    expect(onOpen).toHaveBeenCalledWith(OBJECT, "default");
    expect(onToggle).not.toHaveBeenCalled();

    await user.keyboard("{Control>}");
    await user.click(screen.getByText("skin0"));
    await user.keyboard("{/Control}");
    expect(onOpen).toHaveBeenLastCalledWith(OBJECT, "beside");
  });

  it("pins the tab on a double click", async () => {
    const user = userEvent.setup();
    const { onOpen } = renderRow(OBJECT);

    await user.dblClick(screen.getByText("skin0"));
    expect(onOpen).toHaveBeenLastCalledWith(OBJECT, "permanent");
  });
});
