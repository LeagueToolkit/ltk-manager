// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { ToastProvider } from "@/components";
import type { BinRow, DeclaredState, WorkshopProject } from "@/lib/tauri";
import { mockInvoke } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/utils";

import { ProjectProvider } from "../../../../projects/state/ProjectContext";
import { BinRowLine } from "../../../tree/components/BinRow";
import type { RowLine } from "../../../tree/utils/binRows";
import { DeclaredRowsContext, useDeclaredRows } from "../../hooks/useDeclared";
import { BinEditState } from "../BinEditState";

const ENTRY = "0x2a1f3c7d";
const GLOW = "0000000a.0000000b";
const DOCUMENT = 7;

const PROJECT: WorkshopProject = {
  path: "C:/mods/jade-teemo",
  name: "jade-teemo",
  displayName: "Jade Teemo",
  version: "1.0.0",
  description: "",
  authors: [],
  tags: [],
  champions: [],
  maps: [],
  layers: [
    { name: "base", displayName: "Base", priority: 0, description: null, stringOverrides: {} },
    { name: "chroma", displayName: "Chroma", priority: 1, description: null, stringOverrides: {} },
  ],
  thumbnailPath: null,
  lastModified: "2026-09-21T10:00:00Z",
  location: "workshop",
  lastOpened: null,
  id: "id-jade-teemo",
} as WorkshopProject;

const DECLARED: DeclaredState = {
  layer: "base",
  layers: ["base", "chroma"],
  marks: [{ entry: ENTRY, path: GLOW, sign: "set", whole: false, reference: null, game: "0.0" }],
  diagnostics: [
    {
      entry: ENTRY,
      path: GLOW,
      layer: "base",
      key: "skinMeshProperties.selfIllumination",
      kind: "propertyEditSkipped",
      reason: "kindMismatch",
      detail: null,
    },
    {
      entry: "",
      path: "",
      layer: "chroma",
      key: "-links",
      kind: "linkRemovalUnmatched",
      reason: null,
      detail: null,
    },
  ],
};

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

function glowLine(path: string): RowLine {
  const row: BinRow = {
    entry: ENTRY,
    path,
    label: "skinMeshProperties.selfIllumination",
    node: "property",
    name: "selfIllumination",
    unnamed: false,
    kind: "f32",
    value: { type: "float", value: 0.37 },
    declared: null,
  };
  return {
    kind: "row",
    key: `${ENTRY}:${path}`,
    row,
    depth: 1,
    expanded: false,
    loading: false,
    owner: null,
    parent: null,
    index: 0,
  };
}

function MarkedRows({ children }: { children: ReactNode }) {
  return <DeclaredRowsContext value={useDeclaredRows(DOCUMENT)}>{children}</DeclaredRowsContext>;
}

let declared: DeclaredState | null;

beforeEach(() => {
  declared = DECLARED;
  mockInvoke.mockReset();
  mockInvoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
    if (command === "bin_declared") return Promise.resolve({ ok: true, value: declared });
    if (command === "bin_declare_into") {
      declared = { ...DECLARED, layer: args?.layer as string, marks: [], diagnostics: [] };
      return Promise.resolve({ ok: true, value: declared });
    }
    return Promise.reject(new Error(`unexpected command ${command}`));
  });
});

describe("a declared row", () => {
  it("draws the mark on the row a declaration touches, and on no other", async () => {
    render(
      <MarkedRows>
        <BinRowLine line={glowLine(GLOW)} focused={false} onToggle={() => {}} />
        <BinRowLine line={glowLine("0000000a.0000000c")} focused={false} onToggle={() => {}} />
      </MarkedRows>,
      { wrapper: Providers },
    );

    expect(await screen.findAllByRole("img", { name: "Declared in Base" })).toHaveLength(1);
  });

  it("draws what the apply reported on the row it names", async () => {
    render(
      <MarkedRows>
        <BinRowLine line={glowLine(GLOW)} focused={false} onToggle={() => {}} />
        <BinRowLine line={glowLine("0000000a.0000000c")} focused={false} onToggle={() => {}} />
      </MarkedRows>,
      { wrapper: Providers },
    );

    expect(await screen.findAllByRole("img", { name: "1 apply diagnostic" })).toHaveLength(1);
  });
});

describe("the toolbar of a declared document", () => {
  const asset = { kind: "gameChunk", wad: "Champions/Teemo.wad.client", pathHash: "ab" } as const;

  it("names the layer in place of the save status", async () => {
    render(<BinEditState document={DOCUMENT} asset={asset} readOnly={null} onReload={() => {}} />, {
      wrapper: Providers,
    });

    expect(
      await screen.findByRole("button", { name: "Layer the edits declare into" }),
    ).toHaveTextContent("Base");
  });

  it("draws a diagnostic that names no row beside the layer", async () => {
    render(<BinEditState document={DOCUMENT} asset={asset} readOnly={null} onReload={() => {}} />, {
      wrapper: Providers,
    });

    expect(await screen.findByRole("img", { name: "1 apply diagnostic" })).toBeInTheDocument();
  });

  it("declares into the layer the menu picks", async () => {
    const user = userEvent.setup();
    render(<BinEditState document={DOCUMENT} asset={asset} readOnly={null} onReload={() => {}} />, {
      wrapper: Providers,
    });

    await user.click(await screen.findByRole("button", { name: "Layer the edits declare into" }));
    await user.click(await screen.findByRole("menuitemradio", { name: "Chroma" }));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("bin_declare_into", {
        document: DOCUMENT,
        layer: "chroma",
      }),
    );
    expect(
      await screen.findByRole("button", { name: "Layer the edits declare into" }),
    ).toHaveTextContent("Chroma");
  });

  it("keeps the lock on a game bin that declares nothing", async () => {
    declared = null;
    render(
      <BinEditState document={DOCUMENT} asset={asset} readOnly="install" onReload={() => {}} />,
      { wrapper: Providers },
    );

    expect(await screen.findByText("Read-only")).toBeInTheDocument();
  });
});
