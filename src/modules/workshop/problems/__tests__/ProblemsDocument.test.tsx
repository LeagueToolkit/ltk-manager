// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ToastProvider } from "@/components";
import type {
  AppError,
  FixPreview,
  FixReport,
  NodeAddress,
  ObjectInfo,
  Problem,
  ProblemSeverity,
  RuleFailure,
  RuleInfo,
  Run,
  TypeMismatch,
  WorkshopProject,
} from "@/lib/tauri";
import { DocumentToolbarSlotContext } from "@/modules/editor";
import { useWorkshopEditorStore } from "@/stores/workshopEditor";
import { useWorkshopLayoutStore } from "@/stores/workshopLayout";
import { mockInvoke } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/utils";

import { ProjectProvider } from "../../components/ProjectContext";
import { previewDocumentId } from "../../documents";
import type { ContentDocumentOf } from "../../documents/contentDocument";
import { ProblemsDocument } from "../ProblemsDocument";

/* The surface narrows a document to its kind before it mounts an editor, which
   a test standing in for the surface has to do for itself. */
const DOCUMENT: ContentDocumentOf<"problems"> = { id: "problems", kind: "problems" };

/** Tall enough that every fixture's rows sit inside one window, so none is culled. */
const VIEWPORT_HEIGHT = 800;
const VIEWPORT_WIDTH = 900;

beforeAll(() => {
  /* The virtualizer sizes its window from the scroll element's `offsetHeight`,
     which happy-dom reports as 0 for every node, and a 0px window renders no rows
     at all. A fixed height stands in for the layout it never runs. */
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get: () => VIEWPORT_HEIGHT,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get: () => VIEWPORT_WIDTH,
  });

  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const SKIN0 = "Smolder.wad.client/data/characters/smolder/skins/skin0.bin";
const SKIN1 = "Smolder.wad.client/data/characters/smolder/skins/skin1.bin";
const SKIN4 = "Smolder.wad.client/data/characters/smolder/skins/skin4.bin";

const PROJECT: WorkshopProject = {
  path: "X:/mods/smolder-prestige",
  name: "smolder-prestige",
  displayName: "Smolder Prestige",
  version: "1.0.0",
  description: "",
  authors: [],
  tags: [],
  champions: ["Smolder"],
  maps: [],
  layers: [
    { name: "base", displayName: "Base", priority: 0, description: null, stringOverrides: {} },
    {
      name: "high-res",
      displayName: "High Res",
      priority: 1,
      description: null,
      stringOverrides: {},
    },
  ],
  thumbnailPath: null,
  lastModified: "2026-08-21T21:14:02Z",
};

interface ProblemInit {
  id: string;
  rule?: string;
  severity?: ProblemSeverity;
  layer?: string;
  path?: string;
  node?: NodeAddress | null;
  mismatch?: TypeMismatch | null;
  message?: string;
  fix?: FixPreview | null;
}

function problem(init: ProblemInit): Problem {
  return {
    id: init.id,
    rule: init.rule ?? "bin/property-type",
    severity: init.severity ?? "warning",
    site: {
      layer: init.layer ?? "base",
      path: init.path ?? SKIN0,
      node: init.node ?? null,
    },
    mismatch: init.mismatch ?? { expected: "File", found: "String" },
    message: init.message,
    fix: init.fix ?? null,
  };
}

const ENTRY = "0x9b67e9f6";

/** A leaf property, where a repair swaps one rendered value for another. */
const ICON_AVATAR = problem({
  id: "p-icon-avatar",
  node: { entry: ENTRY, path: "iconAvatar" },
  fix: {
    before: '"ASSETS/Characters/Smolder/HUD/Smolder_Circle.dds"',
    after: "0xabe03fa5cfa7e5c0",
  },
});

/** A container, which draws its item count where a leaf draws a value. */
const ALTERNATE_ICONS = problem({
  id: "p-alternate-icons",
  node: { entry: ENTRY, path: "alternateIconsCircle" },
  mismatch: { expected: "List<File>", found: "List<String>" },
  fix: { note: "3 items", before: null, after: null },
});

/* An empty node path is the object itself, which only its entry hash names. */
const UNNAMED_HASH = problem({
  id: "p-unnamed-hash",
  rule: "bin/asset-exists",
  severity: "error",
  node: { entry: "0x4c2b7a11", path: "" },
  mismatch: null,
  message: "0x2f8e3a1d94b7c6e5 is in no WAD this project ships, and no name resolves it.",
  fix: null,
});

const PARTICLE_PATH = problem({
  id: "p-particle-path",
  path: SKIN1,
  node: { entry: "0x2f1a55c8", path: "particlePath" },
  fix: {
    before: '"ASSETS/Characters/Smolder/Particles/smolder_base_tail.troybin"',
    after: "0x1f7c2ad9e4b60351",
  },
});

const HIGH_RES_ICON = problem({
  id: "p-high-res-icon",
  layer: "high-res",
  node: { entry: ENTRY, path: "iconSquare" },
  fix: {
    before: '"ASSETS/Characters/Smolder/HUD/Smolder_Square.dds"',
    after: "0x6d0f4b8ac21e7739",
  },
});

const UNREADABLE: RuleFailure = {
  rule: "bin/property-type",
  site: { layer: "base", path: SKIN4, node: null },
  message: "The header is not one this manager reads.",
};

const PROBLEMS = [ICON_AVATAR, ALTERNATE_ICONS, UNNAMED_HASH, PARTICLE_PATH, HIGH_RES_ICON];

/* One object named and one left out, which is the state of a project holding
   both Riot's objects and its own. */
const SKIN0_OBJECT = "Characters/Smolder/Skins/Skin0";
const SKIN1_OBJECT = "Characters/Smolder/Skins/Skin1";

const OBJECTS: ObjectInfo[] = [
  { entry: ENTRY, name: SKIN0_OBJECT },
  { entry: "0x2f1a55c8", name: SKIN1_OBJECT },
];

const RETYPE_RULE: RuleInfo = {
  id: "bin/property-type",
  title: "Meta property type mismatch",
  description: "The type of a meta property in a bin file does not match what the game expects",
  state: { kind: "active" },
};

const WAITING_LABEL = "Patch 16.17";
const WAITING_REASON =
  "Riot changes how these values are stored in patch 16.17. Your game is on 16.16, so nothing here is broken yet.";
const WAITING_DETAIL = "Your game is on 16.16.8049184, and the change lands in 16.17.8087655";

/** The same rule on a machine whose game has not taken the change. */
const WAITING_RULE: RuleInfo = {
  ...RETYPE_RULE,
  state: {
    kind: "dormant",
    waiting: WAITING_LABEL,
    reason: WAITING_REASON,
    detail: WAITING_DETAIL,
  },
};

function run(overrides?: Partial<Run>): Run {
  return {
    at: "2026-08-21T21:14:02Z",
    rules: [RETYPE_RULE],
    objects: OBJECTS,
    problems: PROBLEMS,
    failed: [],
    ...overrides,
  };
}

/** More problems than AUTO_EXPAND_LIMIT, which is what starts a list out shut. */
function crowdedRun(): Run {
  const problems = Array.from({ length: 24 }, (_, index) =>
    problem({
      id: `p-crowded-${index}`,
      path: index % 2 === 0 ? SKIN0 : SKIN1,
      node: { entry: ENTRY, path: `crowded${index}` },
    }),
  );
  return run({ problems });
}

const FIX_REPORT: FixReport = {
  stamp: "20260821-211402",
  applied: 1,
  skipped: 0,
  namesKept: 1,
  files: [],
  failed: [],
};

type Envelope<T> = { ok: true; value: T } | { ok: false; error: AppError };

/**
 * Answer each command by name, so a run and its restore points differ.
 *
 * `fix_runs` backs the Undo affordance and `analyze_project` backs the list, and
 * a single blanket answer would hand one of them the other's shape.
 */
function mockBackend(analyzed: Envelope<Run>) {
  mockInvoke.mockImplementation((command: string) => {
    if (command === "analyze_project") return Promise.resolve(analyzed);
    if (command === "fix_runs") return Promise.resolve({ ok: true, value: [] });
    if (command === "fix_problems") return Promise.resolve({ ok: true, value: FIX_REPORT });
    if (command === "undo_fix_run") return Promise.resolve({ ok: true, value: null });
    return Promise.resolve({ ok: true, value: null });
  });
}

/* The surface the document portals its toolbar into. Without one the filter
   and the actions draw nowhere, which is what a document mounted outside a
   surface is supposed to do. */
function ToolbarHost({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <>
      <div ref={setSlot} />
      <DocumentToolbarSlotContext value={slot}>{children}</DocumentToolbarSlotContext>
    </>
  );
}

function renderPanel() {
  const queryClient = createTestQueryClient();
  function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <ProjectProvider project={PROJECT}>
            <ToolbarHost>{children}</ToolbarHost>
          </ProjectProvider>
        </ToastProvider>
      </QueryClientProvider>
    );
  }
  return render(<ProblemsDocument document={DOCUMENT} active />, { wrapper: Providers });
}

/**
 * The accessible name of a group's caret button.
 *
 * The row draws the directory and the file name as two spans so the first can
 * dim and truncate, and names itself so that split never reaches a reader.
 */
function groupName(layer: string, path: string) {
  return `${layer} · ${path}`;
}

/** Resolves once the query has answered and the first group row is drawn. */
function skin0Group() {
  return screen.findByRole("button", { name: groupName("base", SKIN0) });
}

/* The finding rows are the buttons that open nothing. A header can carry the
   same text - an object no table names draws the hash its problems address it
   by - so the caret is what tells the two apart. */
function problemRow(name: RegExp) {
  const rows = screen
    .getAllByRole("button", { name })
    .filter((button) => !button.hasAttribute("aria-expanded"));
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

/** Every open caret, in the order the list draws them. */
function expandedNames() {
  return screen
    .getAllByRole("button", { expanded: true })
    .map((button) => button.getAttribute("aria-label"));
}

function filter() {
  return screen.getByLabelText("Filter problems");
}

/** The accessible name of the switch, which is its label and its count. */
const AHEAD_LABEL = /^Patch 16\.17/;

/** The switch under the filter, for the checks ahead of the installed game. */
function aheadToggle() {
  return screen.findByRole("button", { name: AHEAD_LABEL });
}

/* Read rather than written, so a suite that resets the store between tests is
   resetting it to what a modder who has never touched the switch would see. */
const DEFAULT_FORWARD_LOOKING = useWorkshopLayoutStore.getInitialState().forwardLookingMeta;

/** The tabs of every group, which is where an opened document lands. */
function openTabs() {
  const editor = useWorkshopEditorStore.getState().byProject[PROJECT.path];
  return Object.keys(editor?.documents ?? {});
}

describe("ProblemsDocument", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    useWorkshopEditorStore.setState({ byProject: {} });
    useWorkshopLayoutStore.setState({ forwardLookingMeta: DEFAULT_FORWARD_LOOKING });
  });

  it("draws one group row per file, labelled with its layer and file name", async () => {
    mockBackend({ ok: true, value: run() });
    renderPanel();

    await skin0Group();

    expect(expandedNames()).toEqual([
      groupName("base", SKIN0),
      /* The object holding the error sorts above the one holding warnings, the
         same way its file sorts above a file that only warns. */
      "0x4c2b7a11",
      SKIN0_OBJECT,
      groupName("base", SKIN1),
      SKIN1_OBJECT,
      groupName("high-res", SKIN0),
      SKIN0_OBJECT,
    ]);
  });

  /// Two layers can hold the same relative path, so a row that named only the
  /// file would draw the same label twice and send a fix to the wrong copy.
  it("tells two layers of one file apart by the layer on the row", async () => {
    mockBackend({ ok: true, value: run() });
    renderPanel();

    await skin0Group();
    expect(screen.getByRole("button", { name: groupName("high-res", SKIN0) })).toBeInTheDocument();
  });

  /// A skin mod finds a handful of problems and should read them without
  /// opening anything, which is what AUTO_EXPAND_LIMIT buys.
  it("opens every group on a project that is under the auto-expand limit", async () => {
    mockBackend({ ok: true, value: run() });
    renderPanel();

    await skin0Group();

    expect(screen.queryAllByRole("button", { expanded: false })).toHaveLength(0);
    expect(problemRow(/iconAvatar/)).toBeInTheDocument();
    expect(problemRow(/alternateIconsCircle/)).toBeInTheDocument();
    expect(problemRow(/particlePath/)).toBeInTheDocument();
  });

  /// The check names itself on the row, because a reader arriving at a list of
  /// a hundred findings needs to know what kind of thing they are looking at.
  it("draws the rule's title, the two types and the address", async () => {
    mockBackend({ ok: true, value: run() });
    renderPanel();

    await skin0Group();

    const row = problemRow(/iconAvatar/);
    expect(within(row).getByText(RETYPE_RULE.title)).toBeInTheDocument();
    expect(within(row).getByText("iconAvatar")).toBeInTheDocument();
    expect(within(row).getByText(/Expected/)).toHaveTextContent("Expected File, found String");
  });

  /// A type is a literal out of the file rather than something the panel says,
  /// so it is set apart from the prose around it.
  it("sets each type in code type and the words around them in prose", async () => {
    mockBackend({ ok: true, value: run() });
    renderPanel();

    await skin0Group();

    const row = problemRow(/iconAvatar/);
    expect(within(row).getByText("File").tagName).toBe("CODE");
    expect(within(row).getByText("String").tagName).toBe("CODE");
  });

  /// The hash a repair lands on is not something a reader can act on, and it is
  /// the same on every row that names one texture.
  it("draws no replacement value on the row", async () => {
    mockBackend({ ok: true, value: run() });
    renderPanel();

    await skin0Group();

    const row = problemRow(/iconAvatar/);
    expect(within(row).queryByText("0xabe03fa5cfa7e5c0")).toBeNull();
  });

  /// A container's item types are what changed, so both read as one type each.
  it("draws a container's item types", async () => {
    mockBackend({ ok: true, value: run() });
    renderPanel();

    await skin0Group();

    const row = problemRow(/alternateIconsCircle/);
    expect(within(row).getByText(/Expected/)).toHaveTextContent(
      "Expected List<File>, found List<String>",
    );
    expect(within(row).queryByText(/^0x/)).toBeNull();
  });

  /// A rule the run never described falls back to the id, which every problem
  /// carries, rather than drawing an empty heading.
  it("names a rule the run's catalogue does not describe by its id", async () => {
    mockBackend({ ok: true, value: run() });
    renderPanel();

    await skin0Group();
    await userEvent.type(filter(), "0x4c2b7a11");

    const row = problemRow(/0x4c2b7a11/);
    expect(within(row).getByText("bin/asset-exists")).toBeInTheDocument();
  });

  it("offers no fix on a problem nothing can repair", async () => {
    mockBackend({ ok: true, value: run() });
    renderPanel();

    await skin0Group();
    await userEvent.type(filter(), "0x4c2b7a11");

    expect(problemRow(/0x4c2b7a11/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Fix this problem" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Fix every problem/ })).toBeNull();
  });

  describe("filtering", () => {
    it("narrows the list to the rows whose address matches, case-insensitively", async () => {
      mockBackend({ ok: true, value: run() });
      renderPanel();

      await skin0Group();
      await userEvent.type(filter(), "iconavatar");

      expect(problemRow(/iconAvatar/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /alternateIconsCircle/ })).toBeNull();
      expect(screen.queryByRole("button", { name: /particlePath/ })).toBeNull();
      expect(expandedNames()).toEqual([groupName("base", SKIN0), SKIN0_OBJECT]);
    });

    /// Every term has to land, so a two-word query is an intersection rather
    /// than a phrase the message would have to hold verbatim.
    it("matches on the message as well as the address", async () => {
      mockBackend({ ok: true, value: run() });
      renderPanel();

      await skin0Group();
      await userEvent.type(filter(), "resolves ships");

      expect(problemRow(/0x4c2b7a11/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /iconAvatar/ })).toBeNull();
    });

    /// The type change is the one word a modder has for "the retype problem",
    /// and it is on the row rather than in the message it used to prefix.
    it("matches on the type change", async () => {
      mockBackend({ ok: true, value: run() });
      renderPanel();

      await skin0Group();
      await userEvent.type(filter(), "List<String>");

      expect(problemRow(/alternateIconsCircle/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /iconAvatar/ })).toBeNull();
    });

    /// A modder who wants every finding of one rule types the rule, which is a
    /// string no row draws.
    it("matches on the rule id, which no row shows", async () => {
      mockBackend({ ok: true, value: run() });
      renderPanel();

      await skin0Group();
      await userEvent.type(filter(), "bin/asset-exists");

      expect(problemRow(/0x4c2b7a11/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /iconAvatar/ })).toBeNull();
    });

    it("restores every row once the box is cleared", async () => {
      mockBackend({ ok: true, value: run() });
      renderPanel();

      await skin0Group();
      await userEvent.type(filter(), "iconavatar");
      await userEvent.clear(filter());

      expect(screen.queryAllByRole("button", { expanded: false })).toHaveLength(0);
      expect(problemRow(/particlePath/)).toBeInTheDocument();
    });

    it("shows the no-matches state when nothing answers the query", async () => {
      mockBackend({ ok: true, value: run() });
      renderPanel();

      await skin0Group();
      await userEvent.type(filter(), "gwen");

      expect(screen.getByText("No matches")).toBeInTheDocument();
      expect(screen.getByText('Nothing matches "gwen"')).toBeInTheDocument();
      expect(screen.queryAllByRole("button", { expanded: true })).toHaveLength(0);
    });
  });

  describe("group toggling", () => {
    /// An auto-opened list has nothing in `opened` yet, so the first caret click
    /// has to inherit what is on screen. Toggling against an empty set instead
    /// would shut every group the user never touched.
    it("collapses the group whose caret is clicked and leaves the rest open", async () => {
      mockBackend({ ok: true, value: run() });
      renderPanel();

      const group = await skin0Group();
      await userEvent.click(group);

      expect(group).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByRole("button", { name: /iconAvatar/ })).toBeNull();
      expect(screen.queryByRole("button", { name: /alternateIconsCircle/ })).toBeNull();

      expect(screen.getByRole("button", { name: groupName("base", SKIN1) })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      expect(problemRow(/particlePath/)).toBeInTheDocument();
    });

    it("opens the group again on a second click", async () => {
      mockBackend({ ok: true, value: run() });
      renderPanel();

      const group = await skin0Group();
      await userEvent.click(group);
      await userEvent.click(group);

      expect(group).toHaveAttribute("aria-expanded", "true");
      expect(problemRow(/iconAvatar/)).toBeInTheDocument();
      expect(screen.queryAllByRole("button", { expanded: false })).toHaveLength(0);
    });

    /// A project past the limit starts out shut, where `opened` and `expanded`
    /// are both empty. Seeding the toggle from the groups there opened every
    /// file the click had not landed on.
    it("opens only the clicked group on a list that started out shut", async () => {
      mockBackend({ ok: true, value: crowdedRun() });
      renderPanel();

      const group = await skin0Group();
      expect(screen.queryAllByRole("button", { expanded: true })).toHaveLength(0);

      await userEvent.click(group);

      expect(group).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("button", { name: groupName("base", SKIN1) })).toHaveAttribute(
        "aria-expanded",
        "false",
      );
    });

    /// A bin's findings scatter over its objects, so the object is the level a
    /// reader collapses once they have dealt with it.
    it("collapses one object and leaves the file's other object open", async () => {
      mockBackend({ ok: true, value: run() });
      renderPanel();

      await skin0Group();
      await userEvent.click(screen.getByRole("button", { name: "0x4c2b7a11", expanded: true }));

      expect(screen.queryByRole("button", { name: /bin\/asset-exists/ })).toBeNull();
      expect(problemRow(/iconAvatar/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: groupName("base", SKIN0) })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
    });

    /// The carets rest while a query is on, so a click must record nothing. It
    /// used to seed `opened` from the filtered groups, which shut every group
    /// the query had hidden the moment the box was cleared.
    it("leaves the groups a query hid open once the query is cleared", async () => {
      mockBackend({ ok: true, value: run() });
      renderPanel();

      await skin0Group();
      await userEvent.type(filter(), "iconAvatar");
      await userEvent.click(screen.getByRole("button", { name: groupName("base", SKIN0) }));
      await userEvent.clear(filter());

      expect(screen.getByRole("button", { name: groupName("base", SKIN1) })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
    });
  });

  describe("states with no list", () => {
    it("reports a clean project rather than an empty list", async () => {
      mockBackend({ ok: true, value: run({ problems: [] }) });
      renderPanel();

      expect(await screen.findByText("All good")).toBeInTheDocument();
      expect(screen.queryAllByRole("button", { expanded: true })).toHaveLength(0);
    });

    /// A rule that stopped on a file found nothing there, so the file's absence
    /// from the list is not the file being clean.
    it("warns about a file no rule could read, and names it", async () => {
      mockBackend({ ok: true, value: run({ failed: [UNREADABLE] }) });
      renderPanel();

      await skin0Group();

      const alert = screen.getByRole("alert");
      expect(within(alert).getByText("1 file could not be read")).toBeInTheDocument();
      expect(within(alert).getByText(SKIN4)).toBeInTheDocument();
    });

    it("carries the backend's message into the error state", async () => {
      mockBackend({
        ok: false,
        error: {
          code: "IO",
          message: "X:/mods/smolder-prestige/base is not a directory the manager can read.",
        },
      });
      renderPanel();

      const alert = await screen.findByRole("alert");
      expect(within(alert).getByText("Couldn't check this project")).toBeInTheDocument();
      expect(
        within(alert).getByText(/base is not a directory the manager can read/),
      ).toBeInTheDocument();
    });
  });

  /// A row's wrench repairs that row. Sending the group's whole list would
  /// rewrite properties the user never looked at.
  it("opens the file in a tab on a click", async () => {
    mockBackend({ ok: true, value: run() });
    renderPanel();

    await skin0Group();
    await userEvent.click(problemRow(/iconAvatar/));

    expect(openTabs()).toContain(
      previewDocumentId({ kind: "layer", project: PROJECT.path, layer: "base", path: SKIN0 }),
    );
  });

  /// The preview is keyed by the asset it names, so the file's second problem
  /// activates the tab the first one opened rather than adding another.
  it("opens one tab for two problems of the same file", async () => {
    mockBackend({ ok: true, value: run() });
    renderPanel();

    await skin0Group();
    await userEvent.click(problemRow(/iconAvatar/));
    await userEvent.click(problemRow(/alternateIconsCircle/));

    const previews = openTabs().filter((id) => id.startsWith("preview:"));
    expect(previews).toHaveLength(1);
  });

  it("asks the backend to fix every problem of the object whose wrench was clicked", async () => {
    mockBackend({ ok: true, value: run() });
    renderPanel();

    await skin0Group();
    /* Both layers override the same object, so the query narrows to one file
       before the wrench on its object is unambiguous. */
    await userEvent.type(filter(), "base");
    await userEvent.click(
      screen.getByRole("button", { name: `Fix every problem in ${SKIN0_OBJECT}` }),
    );

    const fixes = mockInvoke.mock.calls.filter(([command]) => command === "fix_problems");
    expect(fixes).toHaveLength(1);
    expect(fixes[0][1]).toEqual({
      projectPath: PROJECT.path,
      problems: ["p-icon-avatar", "p-alternate-icons"],
    });
  });

  it("asks the backend to fix only the problem whose wrench was clicked", async () => {
    mockBackend({ ok: true, value: run() });
    renderPanel();

    await skin0Group();
    await userEvent.type(filter(), "iconAvatar");
    await userEvent.click(screen.getByRole("button", { name: "Fix this problem" }));

    const fixes = mockInvoke.mock.calls.filter(([command]) => command === "fix_problems");
    expect(fixes).toHaveLength(1);
    expect(fixes[0][1]).toEqual({
      projectPath: PROJECT.path,
      problems: ["p-icon-avatar"],
    });
  });

  describe("a check looking ahead of the installed game", () => {
    /* The day a change lands is the day every mod that shipped the old shape
       stops working, so a modder sees what is coming without asking. */
    it("draws its findings, and the toggle pressed, out of the box", async () => {
      mockBackend({ ok: true, value: run({ rules: [WAITING_RULE], problems: [ICON_AVATAR] }) });
      renderPanel();

      expect(await aheadToggle()).toHaveAttribute("aria-pressed", "true");
      expect(await skin0Group()).toBeInTheDocument();
    });

    /* Pressed off, the panel is about the game the user has. The toggle is
       what says the run holds more than the panel is drawing. */
    it("draws the toggle and none of its findings once it is pressed off", async () => {
      mockBackend({ ok: true, value: run({ rules: [WAITING_RULE], problems: [ICON_AVATAR] }) });
      renderPanel();

      await userEvent.click(await aheadToggle());

      expect(await aheadToggle()).toHaveAttribute("aria-pressed", "false");
      expect(await screen.findByText("All good")).toBeInTheDocument();
    });

    /* Every check that speaks about the installed game keeps its rows. */
    it("leaves the rest of the list alone while the linter is off", async () => {
      useWorkshopLayoutStore.setState({ forwardLookingMeta: false });
      mockBackend({ ok: true, value: run({ rules: [WAITING_RULE] }) });
      renderPanel();

      expect(await skin0Group()).toBeInTheDocument();
      expect(screen.queryByText("Meta property type mismatch")).toBeNull();
    });

    /* The point of moving this out of Settings: the switch sits above the list
       it changes, so a modder who does not want it is one click from gone. */
    it("brings them back when the toggle is pressed again", async () => {
      useWorkshopLayoutStore.setState({ forwardLookingMeta: false });
      mockBackend({ ok: true, value: run({ rules: [WAITING_RULE], problems: [ICON_AVATAR] }) });
      renderPanel();

      await userEvent.click(await aheadToggle());

      expect(await aheadToggle()).toHaveAttribute("aria-pressed", "true");
      expect(await skin0Group()).toBeInTheDocument();
    });

    /* The count is the promise the toggle makes, so it counts the whole run
       rather than what the panel happens to be drawing under it. */
    it("counts every finding it would reveal, at either setting", async () => {
      const second = problem({ id: "p-second", severity: "warning", path: SKIN4 });
      mockBackend({
        ok: true,
        value: run({ rules: [WAITING_RULE], problems: [ICON_AVATAR, second] }),
      });
      renderPanel();

      expect(await aheadToggle()).toHaveAccessibleName("Patch 16.17, 2 findings ahead");
      await userEvent.click(await aheadToggle());
      expect(await aheadToggle()).toHaveAccessibleName("Patch 16.17, 2 findings ahead");
    });

    /* A control that is always there and always says nothing is a control a
       reader stops seeing, so it draws only where there is something to draw. */
    it("draws no toggle where every check speaks about this game", async () => {
      mockBackend({ ok: true, value: run() });
      renderPanel();

      await skin0Group();
      expect(screen.queryByRole("button", { name: AHEAD_LABEL })).toBeNull();
    });

    /* A rule can wait on a build and still have found nothing about it. */
    it("draws no toggle where the waiting check found nothing", async () => {
      const crash = problem({ id: "p-crash", severity: "fatal", path: SKIN4 });

      mockBackend({ ok: true, value: run({ rules: [WAITING_RULE], problems: [crash] }) });
      renderPanel();

      await screen.findByRole("button", { name: groupName("base", SKIN4) });
      expect(screen.queryByRole("button", { name: AHEAD_LABEL })).toBeNull();
    });

    /* The sentence a modder acts on is on the toggle rather than over the list,
       and the builds behind it are under that sentence. */
    it("explains itself on hover, fine print and all", async () => {
      mockBackend({ ok: true, value: run({ rules: [WAITING_RULE], problems: [ICON_AVATAR] }) });
      renderPanel();

      await userEvent.hover(await aheadToggle());

      expect(await screen.findByText(WAITING_REASON)).toBeInTheDocument();
      expect(screen.getByText(WAITING_DETAIL)).toBeInTheDocument();
    });

    /* The findings were always in the run, so the setting is a way of reading
       the list rather than a second pass over the project. */
    it("needs no second run to draw them", async () => {
      useWorkshopLayoutStore.setState({ forwardLookingMeta: true });
      mockBackend({ ok: true, value: run({ rules: [WAITING_RULE] }) });
      renderPanel();

      await skin0Group();
      const runs = mockInvoke.mock.calls.filter(([command]) => command === "analyze_project");
      expect(runs).toHaveLength(1);
    });

    /* A crash is a crash on the game that is installed, whatever the rest of
       the rule is still waiting on. */
    it("keeps a crash on screen while the linter is off", async () => {
      useWorkshopLayoutStore.setState({ forwardLookingMeta: false });
      const crash = problem({ id: "p-crash", severity: "fatal", path: SKIN4 });
      mockBackend({ ok: true, value: run({ rules: [WAITING_RULE], problems: [crash] }) });
      renderPanel();

      expect(
        await screen.findByRole("button", { name: groupName("base", SKIN4) }),
      ).toBeInTheDocument();
    });
  });
});
