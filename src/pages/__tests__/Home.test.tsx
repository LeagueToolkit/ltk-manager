// @vitest-environment happy-dom

import { open } from "@tauri-apps/plugin-shell";
import type { Update } from "@tauri-apps/plugin-updater";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  Announcement,
  HealthCheckReadiness,
  Incident,
  InstalledMod,
  ModHealthVerdict,
  Notice,
  ReleaseNote,
  Settings,
} from "@/lib/tauri";
import { createMockIncident } from "@/modules/diagnostics/components/__tests__/fixtures";
import { useHomeStore } from "@/modules/home";
import { verdict } from "@/modules/library/components/__tests__/modHealthFixtures";
import type { ReleaseFeed, UseReleaseHistoryOptions } from "@/modules/updater";
import { useModHealthDrawerStore, useUpdaterStore } from "@/stores";
import { createMockInstalledMod, createMockProfile, createMockSettings } from "@/test/fixtures";
import { mockInvoke } from "@/test/mocks/tauri";
import { renderWithProviders } from "@/test/utils";

import { Home } from "../Home";

const useReleaseHistory = vi.fn<(options: UseReleaseHistoryOptions) => ReleaseFeed>();

vi.mock("@/modules/updater/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/updater/api")>()),
  useReleaseHistory: (options: UseReleaseHistoryOptions) => useReleaseHistory(options),
}));

vi.mock("virtual:release-notes", () => ({
  version: "1.15.4",
  body: "## Fixed\n\n- A fix the build itself carries\n",
}));

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useLocation: () => ({ pathname: "/" }),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onDragDropEvent: () => Promise.resolve(() => {}) }),
}));

/** What the backend answers with, which each case sets before rendering. */
const world = {
  settings: createMockSettings(),
  mods: [] as InstalledMod[],
  verdicts: {} as Record<string, ModHealthVerdict>,
  readiness: "ready" as HealthCheckReadiness,
  patcherAvailable: true,
  incidents: [] as Incident[],
  posts: [] as Announcement[],
  notices: [] as Notice[],
};

function answer(cmd: string): unknown {
  switch (cmd) {
    case "get_settings":
      return world.settings;
    case "get_installed_mods":
      return world.mods;
    case "get_active_mod_profile":
      return createMockProfile({ name: "Default" });
    case "get_platform_support":
      return { patcherAvailable: world.patcherAvailable, os: "windows" };
    case "get_app_info":
      return {
        name: "LTK Manager",
        version: "1.15.4",
        logFilePath: null,
        os: "windows",
        arch: "x64",
      };
    case "list_incidents":
      return world.incidents;
    case "get_mod_health_verdicts":
      return world.verdicts;
    case "get_health_check_readiness":
      return world.readiness;
    case "sweep_mod_health":
      return {
        basis: { build: "16.17.8087655", manager: "1.15.4" },
        checked: world.mods.length,
        skipped: 0,
        repairable: [],
        unrepairable: [],
      };
    case "list_announcements":
      return world.posts;
    case "list_notices":
      return world.notices;
    default:
      return null;
  }
}

function calls(cmd: string) {
  return mockInvoke.mock.calls.filter(([name]) => name === cmd);
}

function history(over: Partial<ReleaseFeed> = {}): ReleaseFeed {
  return {
    releases: [],
    isPending: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    error: null,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
    ...over,
  };
}

function release(version: string, body: string): ReleaseNote {
  return {
    version,
    tag: `v${version}`,
    body,
    publishedAt: "2026-09-03T12:00:00Z",
    prerelease: false,
    url: `https://github.com/LeagueToolkit/ltk-manager/releases/tag/v${version}`,
  };
}

function mod(id: string, enabled = true): InstalledMod {
  return createMockInstalledMod({ id, name: id, displayName: id, enabled });
}

const NOTICE: Notice = {
  id: "2026-09-patch-26-9",
  severity: "warning",
  title: "Patch 26.9: the patcher takes longer to hook",
  url: "https://github.com/orgs/LeagueToolkit/discussions/220",
  publishedAt: "2026-09-01T12:00:00Z",
};

const POSTS: Announcement[] = [
  {
    id: "tag:github.com,2008:10174672",
    title: "[IMPORTANT] Patch 26.9 - Patcher Issues FAQ",
    url: "https://github.com/orgs/LeagueToolkit/discussions/220",
    publishedAt: "2026-06-01T05:44:14+00:00",
  },
  {
    id: "tag:github.com,2008:10000001",
    title: "The new manager",
    url: "https://github.com/orgs/LeagueToolkit/discussions/100",
    publishedAt: "2026-05-15T10:00:00+00:00",
  },
];

/** A configured install on the launcher flow, so the primary button reads Play. */
function settled(settings: Partial<Settings> = {}) {
  world.settings = createMockSettings({
    leaguePath: "C:\\Riot Games\\League of Legends",
    launchMode: "modern",
    migrationDismissed: true,
    ...settings,
  });
}

describe("Home", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockImplementation((cmd: string) =>
      Promise.resolve({ ok: true, value: answer(cmd) }),
    );
    useReleaseHistory.mockReturnValue(history());
    settled();
    world.mods = [mod("a"), mod("b"), mod("c", false)];
    world.verdicts = {};
    world.readiness = "ready";
    world.patcherAvailable = true;
    world.incidents = [];
    world.posts = [];
    world.notices = [];
    useHomeStore.setState({ seenVersion: null, seenPostAt: null, dismissedNoticeIds: [] });
    useModHealthDrawerStore.setState({ open: false, repairRequested: false, hosted: false });
    useUpdaterStore.setState({ update: null, dialogOpen: false, dialogOpener: null });
  });

  describe("the status line", () => {
    it("says nothing when nothing stands between the reader and Play", async () => {
      renderWithProviders(<Home />);

      expect(await screen.findByRole("button", { name: /^Play$/ })).toBeVisible();
      /* The library tile is the only place the facts are said. */
      expect(await screen.findAllByText("Default")).toHaveLength(1);
      expect(screen.getAllByText("2 of 3 enabled")).toHaveLength(1);
    });

    it("says the patcher does not run here, and offers nothing for it", async () => {
      world.patcherAvailable = false;
      renderWithProviders(<Home />);

      expect(await screen.findByText("The patcher does not run on this system yet")).toBeVisible();
      expect(screen.queryByRole("button", { name: /^Play$/ })).toBeNull();
    });

    it("sends a reader with no League folder to the setting", async () => {
      settled({ leaguePath: null });
      renderWithProviders(<Home />);

      expect(await screen.findByText("League's folder is not set")).toBeVisible();
      await userEvent.click(screen.getByRole("button", { name: /Set it$/ }));

      expect(navigate).toHaveBeenCalledWith({
        to: "/settings",
        search: { focus: "general.leaguePath" },
      });
    });
  });

  describe("the health marker", () => {
    /** The marker, which is titled the same whatever it reads. */
    function marker() {
      return screen.getByRole("button", { name: /^Health status/ });
    }

    it("waits for the hashtables, and offers the sync", async () => {
      world.readiness = "unsynced";
      renderWithProviders(<Home />);

      expect(await screen.findByText("No hashtables")).toBeVisible();
      await userEvent.click(marker());

      await waitFor(() => expect(calls("sync_hashtables")).toHaveLength(1));
    });

    it("says the hashtables are syncing, and takes no press until they have", async () => {
      world.readiness = "syncing";
      renderWithProviders(<Home />);

      expect(await screen.findByText("Syncing")).toBeVisible();
      expect(screen.queryByRole("button", { name: /^Health status/ })).toBeNull();
    });

    it("offers a check while no verdict covers the library", async () => {
      renderWithProviders(<Home />);

      expect(await screen.findByText("Not checked")).toBeVisible();
      await userEvent.click(marker());

      await waitFor(() => expect(calls("sweep_mod_health")).toHaveLength(1));
    });

    /* A flagged mod loads and plays, so it is not what the count is spent on,
       and a disabled one reaches no overlay. */
    it("counts the enabled mods no repair reaches, and shows them in the library", async () => {
      world.verdicts = {
        a: verdict("a", "unrepairable"),
        b: verdict("b", "unrepairable", { severity: "warning" }),
        c: verdict("c", "unrepairable"),
      };
      renderWithProviders(<Home />);

      expect(await screen.findByText("1 broken")).toBeVisible();
      await userEvent.click(marker());

      expect(navigate).toHaveBeenCalledWith({ to: "/mods" });
      expect(useModHealthDrawerStore.getState().open).toBe(true);
      expect(useModHealthDrawerStore.getState().repairRequested).toBe(false);
    });

    it("counts the enabled mods a repair reaches, and asks the drawer for it", async () => {
      world.verdicts = { a: verdict("a", "repairable"), b: verdict("b", "repairable") };
      renderWithProviders(<Home />);

      expect(await screen.findByText("2 repairs")).toBeVisible();
      await userEvent.click(marker());

      expect(navigate).toHaveBeenCalledWith({ to: "/mods" });
      expect(useModHealthDrawerStore.getState().repairRequested).toBe(true);
    });

    it("counts what loads with a fault without spending a louder word on it", async () => {
      world.verdicts = { a: verdict("a", "unrepairable", { severity: "warning" }) };
      renderWithProviders(<Home />);

      expect(await screen.findByText("1 flagged")).toBeVisible();
    });

    it("reads healthy once every mod has a verdict, and re-checks on a press", async () => {
      world.verdicts = {
        a: verdict("a", "healthy"),
        b: verdict("b", "healthy"),
        c: verdict("c", "healthy"),
      };
      renderWithProviders(<Home />);

      expect(await screen.findByText("Healthy")).toBeVisible();
      await userEvent.click(marker());

      await waitFor(() => expect(calls("sweep_mod_health")).toHaveLength(1));
    });
  });

  describe("recent changes", () => {
    it("draws the installed version from the build before the feed answers", async () => {
      useReleaseHistory.mockReturnValue(history({ isPending: true }));
      renderWithProviders(<Home />);

      expect(await screen.findByRole("heading", { name: "v1.15.4" })).toBeVisible();
      expect(await screen.findByText("Installed")).toBeVisible();
      expect(screen.getByText("A fix the build itself carries")).toBeVisible();
    });

    it("lets the feed's row for the installed version replace the bundled one", async () => {
      useReleaseHistory.mockReturnValue(
        history({ releases: [release("1.15.4", "- The same fix, as the feed words it")] }),
      );
      renderWithProviders(<Home />);

      expect(await screen.findByText("The same fix, as the feed words it")).toBeVisible();
      expect(screen.queryByText("A fix the build itself carries")).toBeNull();
      expect(screen.getAllByRole("heading", { name: "v1.15.4" })).toHaveLength(1);
      expect(await screen.findAllByText("Installed")).toHaveLength(1);
    });

    it("draws a pending update first, with an Update button that opens the dialog", async () => {
      useUpdaterStore.setState({
        update: { version: "1.16.0", body: "- Something new" } as unknown as Update,
      });
      renderWithProviders(<Home />);

      expect(await screen.findByRole("heading", { name: "v1.16.0" })).toBeVisible();
      expect(screen.getByText("New")).toBeVisible();
      expect(screen.getByText("Something new")).toBeVisible();
      expect(useReleaseHistory).toHaveBeenCalledWith(
        expect.objectContaining({ excludeVersion: "1.16.0" }),
      );

      await userEvent.click(screen.getByRole("button", { name: "Update" }));

      expect(useUpdaterStore.getState().dialogOpen).toBe(true);
      expect(useUpdaterStore.getState().dialogOpener).toBe("press");
    });
  });

  describe("notices", () => {
    it("draws a notice as a banner, opens its link, and keeps it dismissed", async () => {
      world.notices = [NOTICE];
      renderWithProviders(<Home />);

      const banner = await screen.findByRole("alert");
      expect(banner).toHaveTextContent(NOTICE.title);

      await userEvent.click(within(banner).getByRole("button", { name: "What to do" }));
      expect(open).toHaveBeenCalledWith(NOTICE.url);

      await userEvent.click(within(banner).getByRole("button", { name: "Dismiss" }));
      expect(screen.queryByRole("alert")).toBeNull();
      expect(useHomeStore.getState().dismissedNoticeIds).toEqual([NOTICE.id]);
    });
  });

  describe("news", () => {
    it("lists the posts with their dates, then the standing links", async () => {
      world.posts = POSTS;
      renderWithProviders(<Home />);

      expect(
        await screen.findByRole("link", { name: /Patch 26.9 - Patcher Issues FAQ/ }),
      ).toBeVisible();
      expect(screen.getByRole("link", { name: /The new manager/ })).toBeVisible();
      expect(screen.getByRole("link", { name: "Getting started" })).toBeVisible();
      expect(screen.getByRole("button", { name: "Discord" })).toBeVisible();

      await userEvent.click(screen.getByRole("link", { name: /The new manager/ }));
      expect(open).toHaveBeenCalledWith(POSTS[1].url);
    });

    it("stands the links alone when the project has posted nothing", async () => {
      renderWithProviders(<Home />);

      const tile = (await screen.findByText("News")).closest("section")!;
      await waitFor(() => expect(calls("list_announcements")).toHaveLength(1));

      expect(
        within(tile)
          .getAllByRole("link")
          .map((link) => link.textContent),
      ).toEqual(["Getting started", "Managing mods", "Troubleshooting"]);

      /* The community pair is the foot, and a press rather than a fourth link. */
      expect(
        within(tile)
          .getAllByRole("button")
          .map((button) => button.textContent),
      ).toEqual(["Discord", "GitHub"]);
    });
  });

  describe("the library tile", () => {
    it("names the profile, counts the mods, and offers the cslol import until it is dismissed", async () => {
      settled({ migrationDismissed: false });
      renderWithProviders(<Home />);

      const tile = (await screen.findByText("Your library")).closest("section")!;
      expect(await within(tile).findByText("Default")).toBeVisible();
      expect(within(tile).getByText("2 of 3 enabled")).toBeVisible();
      expect(within(tile).getByRole("button", { name: "Import from cslol-manager" })).toBeVisible();

      await userEvent.click(within(tile).getByRole("button", { name: "Dismiss" }));

      await waitFor(() => expect(calls("save_settings")).toHaveLength(1));
      expect(calls("save_settings")[0][1]).toMatchObject({
        settings: { migrationDismissed: true },
      });
    });

    it("opens the library from the tile", async () => {
      renderWithProviders(<Home />);

      await userEvent.click(await screen.findByRole("button", { name: "Open Mods" }));

      expect(navigate).toHaveBeenCalledWith({ to: "/mods" });
    });
  });

  describe("the last game", () => {
    it("says nothing when there is no incident", async () => {
      renderWithProviders(<Home />);

      await waitFor(() => expect(calls("list_incidents")).toHaveLength(1));
      expect(screen.queryByText("Last game")).toBeNull();
    });

    it("draws the latest verdict, and reviews it in Diagnostics", async () => {
      world.incidents = [createMockIncident()];
      renderWithProviders(<Home />);

      expect(await screen.findByText("Missing Game Data")).toBeVisible();
      expect(screen.getByText("Game stopped")).toBeVisible();

      await userEvent.click(screen.getByRole("button", { name: "Review" }));

      expect(navigate).toHaveBeenCalledWith({
        to: "/diagnostics",
        search: { tab: "games", incident: "2026-08-21T21-14-02" },
      });
    });
  });
});
