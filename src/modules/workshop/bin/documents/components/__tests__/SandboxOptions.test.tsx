// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { ToastProvider } from "@/components";
import type {
  AssetRef,
  BinDocumentHandle,
  DeclaredModuleChoice,
  DeclaredState,
  GameFileEntry,
  LayerOverride,
  ObjectDeclaration,
  WorkshopProject,
} from "@/lib/tauri";
import { commandNames } from "@/test/commandNames";
import { mockInvoke } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/utils";

import { type ContentDocument, objectDocument } from "../../../../documents/utils/contentDocument";
import { ProjectProvider } from "../../../../projects/state/ProjectContext";
import {
  DocumentSandboxProvider,
  RouteSandboxProvider,
} from "../../../../sandbox/state/SandboxContext";
import { EMPTY_EDITOR, useWorkshopEditorStore } from "../../../../state";
import { SandboxOptions } from "../SandboxOptions";

const DOCUMENT = 7;
const ENTRY = "0x2a1f3c7d";

const PROJECT = {
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

const IN_PROJECT = { kind: "project", project: PROJECT.path } as const;

const CHUNK: AssetRef = { kind: "gameChunk", wad: "Champions/Teemo.wad.client", pathHash: "ab" };
const SKIN_PATH = "data/characters/teemo/skins/skin0.bin";
const LAYER_FILE: AssetRef = {
  kind: "layer",
  project: PROJECT.path,
  layer: "chroma",
  path: `Teemo.wad.client/${SKIN_PATH}`,
};

const DECLARED: DeclaredState = {
  layer: "base",
  module: { kind: "auto" },
  modules: [
    { index: 0, name: null, takesKeys: true },
    { index: 1, name: "Glow", takesKeys: true },
    { index: 2, name: null, takesKeys: false },
  ],
  layers: ["base", "chroma"],
  marks: [],
  objects: [],
  links: [],
  diagnostics: [],
};

function openBin(overrides: Partial<BinDocumentHandle> = {}): BinDocumentHandle {
  return {
    document: DOCUMENT,
    sandbox: IN_PROJECT,
    asset: CHUNK,
    header: { kind: "prop", version: 3, objects: 1, dependencies: [], patches: 0, deleted: [] },
    rows: [],
    object: null,
    readOnly: null,
    declared: DECLARED,
    ...overrides,
  };
}

/** Two rows the chroma layer declares, one of them twice. */
const CHROMA_DECLARES: LayerOverride[] = ["0000000a", "0000000a", "0000000b"].map((path) => ({
  layer: "chroma",
  mark: {
    entry: ENTRY,
    path,
    property: "a",
    module: 0,
    moduleName: null,
    sign: "set",
    whole: false,
    reference: null,
    game: null,
  },
  value: null,
}));

let declared: DeclaredState | null;
let installed: Record<string, GameFileEntry>;
/** The files declaring `ENTRY` in each sandbox, and null for an index that does not answer. */
let declarations: { game: ObjectDeclaration[]; project: ObjectDeclaration[] } | null;

const layerDeclaration: ObjectDeclaration = {
  asset: LAYER_FILE,
  file: LAYER_FILE.kind === "layer" ? LAYER_FILE.path : "",
  classHash: "0x00000001",
  class: "VfxSystemDefinitionData",
};

function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => createTestQueryClient());
  return (
    <QueryClientProvider client={client}>
      <ProjectProvider project={PROJECT}>
        <RouteSandboxProvider project={PROJECT.path}>
          <ToastProvider>{children}</ToastProvider>
        </RouteSandboxProvider>
      </ProjectProvider>
    </QueryClientProvider>
  );
}

/** Open `tab` in the editor and draw its options, as its toolbar does. */
function drawTab(tab: ContentDocument, handle: BinDocumentHandle) {
  useWorkshopEditorStore.getState().openDocument(PROJECT.path, tab);
  const sandbox = "sandbox" in tab ? tab.sandbox : undefined;
  return render(
    <DocumentSandboxProvider sandbox={sandbox}>
      <SandboxOptions documentId={tab.id} handle={handle} />
    </DocumentSandboxProvider>,
    { wrapper: Providers },
  );
}

function openTabs(): readonly ContentDocument[] {
  return Object.values(useWorkshopEditorStore.getState().byProject[PROJECT.path]?.documents ?? {});
}

const CHUNK_TAB = objectDocument(CHUNK, ENTRY, "Characters/Teemo/Skins/Skin0", SKIN_PATH);

beforeEach(() => {
  useWorkshopEditorStore.setState({ byProject: { [PROJECT.path]: EMPTY_EDITOR } });
  declared = DECLARED;
  installed = {};
  declarations = null;
  useWorkshopEditorStore.getState().selectModule(PROJECT.path, null);
  useWorkshopEditorStore.getState().selectLayer(PROJECT.path, "base");
  mockInvoke.mockReset();
  mockInvoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
    if (command === commandNames.bin.binDeclared)
      return Promise.resolve({ ok: true, value: declared });
    if (command === commandNames.bin.binDeclareInto) {
      declared = {
        ...DECLARED,
        layer: args?.layer as string,
        module: args?.module as DeclaredModuleChoice,
      };
      return Promise.resolve({ ok: true, value: declared });
    }
    if (command === commandNames.game.locateGameFiles)
      return Promise.resolve({ ok: true, value: installed });
    if (command === commandNames.objects.declaredObjects && declarations !== null) {
      const sandbox = args?.sandbox as { kind: string };
      const files = sandbox.kind === "game" ? declarations.game : declarations.project;
      const objects =
        files.length === 0 ? {} : { [ENTRY]: { path: "Mods/Jade/Glow", declarations: files } };
      return Promise.resolve({ ok: true, value: { index: { status: "ready" }, objects } });
    }
    if (command === commandNames.bin.binOverrides)
      return Promise.resolve({ ok: true, value: CHROMA_DECLARES });
    if (command === commandNames.bin.binEdit && declared !== null) {
      declared = {
        ...declared,
        modules: [
          ...declared.modules,
          { index: declared.modules.length, name: null, takesKeys: true },
        ],
      };
      return Promise.resolve({ ok: true, value: { kind: "declared", state: declared } });
    }
    return Promise.reject(new Error(`unexpected command ${command}`));
  });
});

const TRIGGER = /^Sandbox \(/;

async function openOptions(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: TRIGGER }));
}

/** Point at the submenu row named `name` and wait out Base UI's open delay. */
async function openSubmenu(user: ReturnType<typeof userEvent.setup>, name: string | RegExp) {
  await user.hover(await screen.findByRole("menuitem", { name }));
  await waitFor(() => expect(screen.getAllByRole("menu").length).toBeGreaterThan(1));
}

function expectDisabled(item: HTMLElement) {
  expect(item).toHaveAttribute("aria-disabled", "true");
}

describe("the Layers of the Sandbox options", () => {
  it("moves the tab to a subset under its id, and back to the project with every layer", async () => {
    const user = userEvent.setup();
    drawTab(CHUNK_TAB, openBin());

    await openOptions(user);
    await openSubmenu(user, "Layers: 2 of 2");
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Chroma" }));

    expect(openTabs()).toHaveLength(1);
    expect(openTabs()[0]).toMatchObject({
      id: CHUNK_TAB.id,
      sandbox: { kind: "layers", project: PROJECT.path, layers: ["base"] },
    });
    expect(screen.getByRole("menuitemcheckbox", { name: "Chroma" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expectDisabled(screen.getByRole("menuitemcheckbox", { name: "Base" }));

    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Chroma" }));

    expect(openTabs()[0]?.id).toBe(CHUNK_TAB.id);
    expect(openTabs()[0]).not.toHaveProperty("sandbox");
  });

  it("disables the layer of the tab's file", async () => {
    const user = userEvent.setup();
    drawTab(objectDocument(LAYER_FILE, ENTRY, "Skin0", SKIN_PATH), openBin({ asset: LAYER_FILE }));

    await openOptions(user);
    await openSubmenu(user, "Layers: 2 of 2");

    expectDisabled(screen.getByRole("menuitemcheckbox", { name: "Chroma" }));
  });
});

describe("the Sandbox options of a declared document", () => {
  it("name the project's sandbox and the layer the next edit lands in", async () => {
    const user = userEvent.setup();
    drawTab(CHUNK_TAB, openBin());

    expect(
      await screen.findByRole("button", { name: "Sandbox (Jade Teemo), edits go to Base" }),
    ).toHaveTextContent("Sandbox (Jade Teemo)Base");
    await openOptions(user);

    expect(await screen.findByRole("menuitem", { name: "Active layer: Base" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Module: Automatic" })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: "Jade Teemo" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("declare into the layer the options pick", async () => {
    const user = userEvent.setup();
    drawTab(CHUNK_TAB, openBin());

    await openOptions(user);
    await openSubmenu(user, "Active layer: Base");
    expect(screen.getByRole("menuitemradio", { name: "Base" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    /* `fireEvent`, because userEvent's pointer path leaves the trigger and shuts the submenu. */
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Chroma" }));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith(commandNames.bin.binDeclareInto, {
        document: DOCUMENT,
        layer: "chroma",
        module: { kind: "auto" },
      }),
    );
  });

  it("disable the layer and the module while the project's declarations are off", async () => {
    const user = userEvent.setup();
    drawTab(CHUNK_TAB, openBin({ readOnly: "declarationsOff" }));

    expect(await screen.findByRole("button", { name: TRIGGER })).toHaveAccessibleName(
      "Sandbox (Jade Teemo)",
    );
    await openOptions(user);

    expect(await screen.findByText("Game data declarations are off")).toBeInTheDocument();
    expectDisabled(screen.getByRole("menuitem", { name: "Active layer: Base" }));
    expectDisabled(screen.getByRole("menuitem", { name: "Module: Automatic" }));
    expect(
      screen.queryByRole("menuitemcheckbox", { name: "Use game data declarations" }),
    ).not.toBeInTheDocument();
  });

  it("join the module picked, automatic until one is, and name it on the button", async () => {
    const user = userEvent.setup();
    drawTab(CHUNK_TAB, openBin());

    await openOptions(user);
    await openSubmenu(user, "Module: Automatic");
    expect(screen.getByRole("menuitemradio", { name: "Automatic" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("menuitemradio", { name: "Module 1" })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("menuitemradio", { name: "Module 3" })).toHaveAccessibleDescription(
      "A target module takes no new keys",
    );
    expectDisabled(screen.getByRole("menuitemradio", { name: "Module 3" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Glow" }));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith(commandNames.bin.binDeclareInto, {
        document: DOCUMENT,
        layer: "base",
        module: { kind: "index", index: 1 },
      }),
    );
    expect(
      await screen.findByRole("button", { name: "Sandbox (Jade Teemo), edits go to Base, Glow" }),
    ).toBeInTheDocument();
  });

  it("make a new module at once and join it", async () => {
    const user = userEvent.setup();
    drawTab(CHUNK_TAB, openBin());

    await openOptions(user);
    await openSubmenu(user, "Module: Automatic");
    fireEvent.click(screen.getByRole("menuitem", { name: "New module" }));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith(commandNames.bin.binEdit, {
        document: DOCUMENT,
        edit: { kind: "moduleAction", layer: "base", action: { kind: "create", name: null } },
      }),
    );
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith(commandNames.bin.binDeclareInto, {
        document: DOCUMENT,
        layer: "base",
        module: { kind: "index", index: 3 },
      }),
    );
  });

  it("mark the changes of each layer, counting the rows each touches", async () => {
    const user = userEvent.setup();
    drawTab(CHUNK_TAB, openBin());

    await openOptions(user);
    await openSubmenu(user, "Mark changes from: 2 of 2");

    const base = screen.getByRole("menuitemcheckbox", { name: "Base" });
    expect(base).toHaveAccessibleDescription("Marked while edits go to it");
    expectDisabled(base);
    const chroma = screen.getByRole("menuitemcheckbox", { name: "Chroma" });
    await waitFor(() => expect(chroma).toHaveAccessibleDescription("2 rows changed in this file"));
    expect(chroma).toHaveAttribute("aria-checked", "true");

    fireEvent.click(chroma);

    expect(useWorkshopEditorStore.getState().byProject[PROJECT.path]?.hiddenMarkLayers).toEqual([
      "chroma",
    ]);
    expect(
      await screen.findByRole("menuitem", { name: "Mark changes from: 1 of 2" }),
    ).toBeInTheDocument();
  });

  it("leave out the layer and the marks in a project of one layer", async () => {
    const user = userEvent.setup();
    declared = { ...DECLARED, layers: ["base"] };
    drawTab(CHUNK_TAB, openBin({ declared }));

    await openOptions(user);

    expect(await screen.findByRole("menuitem", { name: "Module: Automatic" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /^Active layer/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /^Mark changes from/ })).not.toBeInTheDocument();
  });
});

/* Acceptance test 5 of docs/plans/sandbox.md: picking the game opens the game's copy
   read-only in the same tab, and the choice is disabled for a path only a layer holds. */
describe("the sandbox choice", () => {
  it("switches a game bin's tab to the game sandbox in place", async () => {
    const user = userEvent.setup();
    drawTab(CHUNK_TAB, openBin());

    await openOptions(user);
    await user.click(await screen.findByRole("menuitemradio", { name: "Game" }));

    expect(openTabs()).toEqual([
      expect.objectContaining({
        id: `object@game:${CHUNK_TAB.id.slice("object:".length)}`,
        asset: CHUNK,
        sandbox: { kind: "game" },
      }),
    ]);
  });

  it("switches a layer file's tab to the install's copy of its path", async () => {
    installed = {
      [SKIN_PATH]: {
        pathHash: "00cd",
        path: SKIN_PATH,
        sizeBytes: 64,
        wad: "Champions/Teemo.wad.client",
      },
    };
    const user = userEvent.setup();
    const tab = objectDocument(LAYER_FILE, ENTRY, "Characters/Teemo/Skins/Skin0", SKIN_PATH);
    drawTab(tab, openBin({ asset: LAYER_FILE, declared: null }));
    declared = null;

    await openOptions(user);
    const game = await screen.findByRole("menuitemradio", { name: "Game" });
    await waitFor(() => expect(game).not.toHaveAttribute("aria-disabled", "true"));
    await user.click(game);

    expect(openTabs()).toEqual([
      expect.objectContaining({
        asset: { kind: "gameChunk", wad: "Champions/Teemo.wad.client", pathHash: "00cd" },
        sandbox: { kind: "game" },
      }),
    ]);
  });

  it("disables the game for a path only a layer holds", async () => {
    const user = userEvent.setup();
    const tab = objectDocument(LAYER_FILE, ENTRY, "Mods/Jade/Glow", SKIN_PATH);
    declared = null;
    drawTab(tab, openBin({ asset: LAYER_FILE, declared: null }));

    await openOptions(user);

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith(commandNames.game.locateGameFiles, {
        paths: [SKIN_PATH],
      }),
    );
    expectDisabled(await screen.findByRole("menuitemradio", { name: "Game" }));
  });

  it("switches an object tab to the file the game declares the object in, at another path", async () => {
    const elsewhere: ObjectDeclaration = {
      asset: { kind: "gameChunk", wad: "Champions/Teemo.wad.client", pathHash: "00ef" },
      file: "data/characters/teemo/teemo_multi.bin",
      classHash: "0x00000001",
      class: "VfxSystemDefinitionData",
    };
    declarations = { game: [elsewhere], project: [layerDeclaration, elsewhere] };
    const user = userEvent.setup();
    const tab = objectDocument(LAYER_FILE, ENTRY, "Characters/Teemo/Skins/Skin0", SKIN_PATH);
    declared = null;
    drawTab(tab, openBin({ asset: LAYER_FILE, declared: null }));

    await openOptions(user);
    const game = await screen.findByRole("menuitemradio", { name: "Game" });
    await waitFor(() => expect(game).not.toHaveAttribute("aria-disabled", "true"));
    await user.click(game);

    expect(openTabs()).toEqual([
      expect.objectContaining({
        asset: elsewhere.asset,
        file: elsewhere.file,
        objectHash: ENTRY,
        sandbox: { kind: "game" },
      }),
    ]);
  });

  it("lists the files declaring the object in the sandbox, and switches the tab to the one picked", async () => {
    const elsewhere: ObjectDeclaration = {
      asset: { kind: "gameChunk", wad: "Champions/Teemo.wad.client", pathHash: "00ef" },
      file: "data/characters/teemo/teemo_multi.bin",
      classHash: "0x00000001",
      class: "VfxSystemDefinitionData",
    };
    declarations = { game: [elsewhere], project: [layerDeclaration, elsewhere] };
    const user = userEvent.setup();
    const tab = objectDocument(LAYER_FILE, ENTRY, "Characters/Teemo/Skins/Skin0", SKIN_PATH);
    declared = null;
    drawTab(tab, openBin({ asset: LAYER_FILE, declared: null }));

    await openOptions(user);
    const own = await screen.findByRole("menuitemradio", { name: "skin0.bin" });
    expect(own).toHaveAttribute("aria-checked", "true");
    expect(own).toHaveAccessibleDescription("Chroma");
    const other = screen.getByRole("menuitemradio", { name: "teemo_multi.bin" });
    expect(other).toHaveAccessibleDescription("Teemo");
    await user.click(other);

    expect(openTabs()).toEqual([
      expect.objectContaining({ asset: elsewhere.asset, file: elsewhere.file }),
    ]);
    expect(openTabs()[0]).not.toHaveProperty("sandbox");
  });

  it("lists no files for an object one file declares", async () => {
    declarations = { game: [], project: [layerDeclaration] };
    const user = userEvent.setup();
    const tab = objectDocument(LAYER_FILE, ENTRY, "Mods/Jade/Glow", SKIN_PATH);
    declared = null;
    drawTab(tab, openBin({ asset: LAYER_FILE, declared: null }));

    await openOptions(user);

    expect(await screen.findByRole("menuitemradio", { name: "Jade Teemo" })).toBeInTheDocument();
    expect(screen.queryByText("Declared in")).not.toBeInTheDocument();
  });

  it("switches a game tab back to the project's sandbox", async () => {
    const user = userEvent.setup();
    const tab = objectDocument(CHUNK, ENTRY, "Characters/Teemo/Skins/Skin0", SKIN_PATH, null, {
      kind: "game",
    });
    declared = null;
    drawTab(tab, openBin({ sandbox: { kind: "game" }, readOnly: "gameSandbox", declared: null }));

    expect(await screen.findByRole("button", { name: TRIGGER })).toHaveAccessibleName(
      "Sandbox (Game)",
    );
    await openOptions(user);
    await user.click(await screen.findByRole("menuitemradio", { name: "Jade Teemo" }));

    expect(openTabs()).toEqual([expect.objectContaining({ id: CHUNK_TAB.id })]);
    expect(openTabs()[0]).not.toHaveProperty("sandbox");
  });
});
