// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import type { AssetInfo, GameFileEntry, WorkshopProject } from "@/lib/tauri";
import { mockInvoke } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/utils";

import { ProjectProvider } from "../../components/ProjectContext";
import { nameHash } from "../binHash";
import { FileChip, StringValue } from "../LinkChip";
import { type LinkTargets, LinkTargetsContext } from "../useLinkTargets";

const PROJECT: WorkshopProject = {
  path: "X:/mods/mine",
  name: "mine",
  displayName: "Mine",
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

function located(path: string): GameFileEntry {
  return { pathHash: "00cc", path, sizeBytes: 12n, wad: "Champions/Aatrox.wad.client" };
}

function targets(paths: readonly string[]): LinkTargets {
  return {
    index: { status: "ready" },
    declared: new Map(),
    located: new Map(paths.map((path) => [path, located(path)])),
    pending: false,
  };
}

function Providers({ children, links }: { children: ReactNode; links: LinkTargets }) {
  const [client] = useState(() => createTestQueryClient());
  return (
    <QueryClientProvider client={client}>
      <ProjectProvider project={PROJECT}>
        <LinkTargetsContext value={links}>{children}</LinkTargetsContext>
      </ProjectProvider>
    </QueryClientProvider>
  );
}

function renderChip(path: string, sniffed?: AssetInfo) {
  mockInvoke.mockImplementation((command: string) => {
    if (command === "read_asset_info" && sniffed) {
      return Promise.resolve({ ok: true, value: sniffed });
    }
    return Promise.resolve({ ok: false, error: { code: "UNKNOWN" } });
  });
  render(
    <Providers links={targets([path])}>
      <FileChip hash="00cc" path={path} />
    </Providers>,
  );
}

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("FileChip", () => {
  it("follows a texture's chip with its swatch and the side that answered", async () => {
    renderChip("assets/characters/aatrox/aatrox.tex");

    expect(
      screen.getByRole("button", { name: "assets/characters/aatrox/aatrox.tex" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Texture preview" })).toBeInTheDocument();
    expect(screen.getByText("Aatrox")).toBeInTheDocument();
    expect(mockInvoke).not.toHaveBeenCalledWith("read_asset_info", expect.anything());
  });

  it("follows any other kind's chip with its badge and no swatch", () => {
    renderChip("data/characters/aatrox/aatrox.bin");

    expect(screen.getByRole("img", { name: "Property Bin" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Texture preview" })).toBeNull();
  });

  it("sniffs a name with no extension, and gives a texture its swatch", async () => {
    renderChip("assets/characters/aatrox/0123456789abcdef", {
      kind: "texture",
      width: 64,
      height: 64,
      container: "DDS",
      format: null,
      mipCount: 1,
      sizeBytes: 16_512n,
    });

    expect(await screen.findByRole("button", { name: "Texture preview" })).toBeInTheDocument();
    expect(mockInvoke).toHaveBeenCalledWith("read_asset_info", expect.anything());
  });

  it("badges a sniffed name by what the bytes say it is", async () => {
    renderChip("assets/characters/aatrox/0123456789abcdef", {
      kind: "unsupported",
      fileKind: "skeleton",
    });

    await waitFor(() => {
      expect(screen.getByRole("img", { name: "Skeleton" })).toBeInTheDocument();
    });
  });
});

describe("StringValue", () => {
  function renderString(text: string, links: LinkTargets) {
    mockInvoke.mockImplementation(() => Promise.resolve({ ok: false, error: { code: "UNKNOWN" } }));
    render(
      <Providers links={links}>
        <StringValue text={text} />
      </Providers>,
    );
  }

  it("draws the chip and the swatch a file draws for a path the install holds", () => {
    renderString(
      "ASSETS/Characters/Aatrox/Aatrox.tex",
      targets(["assets/characters/aatrox/aatrox.tex"]),
    );

    expect(
      screen.getByRole("button", { name: "assets/characters/aatrox/aatrox.tex" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Texture preview" })).toBeInTheDocument();
  });

  it("draws the object chip for a string the index declares an object under", () => {
    const path = "Characters/Aatrox/Skins/Skin0/Resources";
    const links: LinkTargets = {
      index: { status: "ready" },
      declared: new Map([
        [
          nameHash(path),
          {
            path,
            declarations: [
              {
                asset: { kind: "gameChunk", wad: "Champions/Aatrox.wad.client", pathHash: "00aa" },
                file: "data/characters/aatrox/skins/skin0.bin",
                classHash: "0x9b67e9f6",
                class: "SkinCharacterDataProperties",
              },
            ],
          },
        ],
      ]),
      located: new Map(),
      pending: false,
    };

    renderString(path, links);
    expect(screen.getByRole("button", { name: path })).toBeInTheDocument();
  });

  it("draws the field for a string that names nothing", () => {
    renderString("Justicar Aatrox", targets([]));

    expect(screen.getByDisplayValue("Justicar Aatrox")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
