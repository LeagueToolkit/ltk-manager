// @vitest-environment happy-dom

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api, type InstalledMod, type ModDocument, type ModLicense } from "@/lib/tauri";
import { useLibrarySidebarStore } from "@/modules/library";
import { renderWithProviders } from "@/test/utils";

import { DocumentsSidebar } from "../DocumentsSidebar";

vi.mock("@/lib/tauri", async (original) => {
  const actual = await original<typeof import("@/lib/tauri")>();
  return {
    ...actual,
    api: { ...actual.api, getModReadme: vi.fn(), getModLicenseText: vi.fn() },
  };
});

const readme = vi.mocked(api.getModReadme);
const licenseText = vi.mocked(api.getModLicenseText);

function mod(id: string, displayName: string, license: ModLicense | null = null): InstalledMod {
  return {
    id,
    name: id,
    displayName,
    version: "1.0.0",
    description: null,
    authors: [],
    enabled: true,
    installedAt: "2026-09-01T10:00:00Z",
    layers: [],
    tags: [],
    champions: [],
    maps: [],
    modDir: `/storage/mods/${id}`,
    format: "fantome",
    storage: "archive",
    hasArchive: true,
    folderId: null,
    license,
  };
}

function answers(document: ModDocument) {
  return { ok: true as const, value: document };
}

beforeEach(() => {
  readme.mockReset();
  licenseText.mockReset();
  useLibrarySidebarStore.setState({ open: true, tab: "readme", modId: null, split: null });
});

describe("the readme tab", () => {
  it("renders the mod's readme as Markdown", async () => {
    readme.mockResolvedValue(answers({ state: "present", text: "# Install me\n\nDrop it in." }));
    useLibrarySidebarStore.setState({ modId: "a" });

    renderWithProviders(<DocumentsSidebar mods={[mod("a", "My Mod")]} />);

    expect(await screen.findByRole("heading", { name: "Install me" })).toBeInTheDocument();
    expect(screen.getByText("Drop it in.")).toBeInTheDocument();
  });

  it("renders a readme holding only a heading as that heading", async () => {
    readme.mockResolvedValue(answers({ state: "present", text: "# My Mod" }));
    useLibrarySidebarStore.setState({ modId: "a" });

    renderWithProviders(<DocumentsSidebar mods={[mod("a", "My Mod")]} />);

    expect(await screen.findByRole("heading", { name: "My Mod" })).toBeInTheDocument();
  });

  /* A damaged archive means the mod may not work at all, so it cannot read as a
     mod whose author simply wrote nothing. */
  it("tells an absent readme from an archive that would not open", async () => {
    readme.mockResolvedValue(answers({ state: "absent" }));
    useLibrarySidebarStore.setState({ modId: "a" });

    const { unmount } = renderWithProviders(<DocumentsSidebar mods={[mod("a", "My Mod")]} />);
    expect(await screen.findByText("No readme")).toBeInTheDocument();
    unmount();

    readme.mockResolvedValue(answers({ state: "unreadable", reason: "not a zip" }));
    renderWithProviders(<DocumentsSidebar mods={[mod("a", "My Mod")]} />);

    expect(await screen.findByText("Readme unreadable")).toBeInTheDocument();
    expect(screen.getByText("not a zip")).toBeInTheDocument();
  });

  it("names the open mod in the panel header", async () => {
    readme.mockResolvedValue(answers({ state: "present", text: "text" }));
    useLibrarySidebarStore.setState({ modId: "a" });

    renderWithProviders(<DocumentsSidebar mods={[mod("a", "My Mod")]} />);

    expect(await screen.findByText("My Mod")).toBeInTheDocument();
  });

  /* Uninstalling clears the panel rather than closing it: no stale content, and
     no layout change nobody asked for on top of the uninstall. */
  it("clears to an empty state when the open mod is uninstalled", async () => {
    readme.mockResolvedValue(answers({ state: "present", text: "# Install me" }));
    useLibrarySidebarStore.setState({ modId: "a" });

    const { rerender } = renderWithProviders(<DocumentsSidebar mods={[mod("a", "My Mod")]} />);
    await screen.findByRole("heading", { name: "Install me" });

    rerender(<DocumentsSidebar mods={[]} />);

    expect(screen.getByText("Mod uninstalled")).toBeInTheDocument();
    expect(useLibrarySidebarStore.getState().open).toBe(true);
  });
});

describe("the licenses tab", () => {
  const mods = [
    mod("a", "Alpha", { name: "MIT", url: null }),
    mod("b", "Beta", { name: "MIT", url: null }),
    mod("c", "Gamma", null),
  ];

  beforeEach(() => {
    useLibrarySidebarStore.setState({ tab: "licenses" });
  });

  it("lists every installed mod under the license it declares", () => {
    renderWithProviders(<DocumentsSidebar mods={mods} />);

    expect(screen.getByText("MIT")).toBeInTheDocument();
    expect(screen.getByText("Not declared")).toBeInTheDocument();
    for (const name of ["Alpha", "Beta", "Gamma"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it("does not follow whichever mod the readme tab holds", () => {
    useLibrarySidebarStore.setState({ modId: "a" });

    renderWithProviders(<DocumentsSidebar mods={mods} />);

    expect(screen.getByText("Gamma")).toBeInTheDocument();
  });

  it("expands a row to its license text, preformatted", async () => {
    licenseText.mockResolvedValue(answers({ state: "present", text: "MIT License\n\nAs is." }));

    renderWithProviders(<DocumentsSidebar mods={mods} />);
    await userEvent.click(screen.getByRole("button", { name: /Alpha/ }));

    expect(await screen.findByText(/MIT License/)).toBeInTheDocument();
    expect(licenseText).toHaveBeenCalledWith("a");
  });

  /* The middle state is the common one, and telling it from silence is the
     whole point of the gallery. */
  it("says a mod names a license and ships no text for it", async () => {
    licenseText.mockResolvedValue(answers({ state: "absent" }));

    renderWithProviders(<DocumentsSidebar mods={mods} />);
    await userEvent.click(screen.getByRole("button", { name: /Alpha/ }));

    expect(
      await screen.findByText("This mod names a license and ships no text for it"),
    ).toBeInTheDocument();
  });

  it("says so rather than reading as unlicensed when the archive will not open", async () => {
    licenseText.mockResolvedValue(answers({ state: "unreadable", reason: "not a zip" }));

    renderWithProviders(<DocumentsSidebar mods={mods} />);
    await userEvent.click(screen.getByRole("button", { name: /Alpha/ }));

    expect(await screen.findByText(/its license cannot be read/)).toBeInTheDocument();
  });

  it("offers nothing to expand for a mod that declares no license", () => {
    renderWithProviders(<DocumentsSidebar mods={mods} />);

    expect(screen.queryByRole("button", { name: /Gamma/ })).toBeNull();
  });

  it("reads one mod's license at most once", async () => {
    licenseText.mockResolvedValue(answers({ state: "present", text: "MIT License" }));

    renderWithProviders(<DocumentsSidebar mods={mods} />);
    const row = screen.getByRole("button", { name: /Alpha/ });
    await userEvent.click(row);
    await screen.findByText(/MIT License/);
    await userEvent.click(row);
    await userEvent.click(row);
    await screen.findByText(/MIT License/);

    expect(licenseText).toHaveBeenCalledOnce();
  });

  it("filters rows by mod name and by license name alike", async () => {
    renderWithProviders(<DocumentsSidebar mods={mods} />);
    const search = screen.getByRole("searchbox");

    await userEvent.type(search, "mit");

    await waitFor(() => expect(screen.queryByText("Gamma")).toBeNull());
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });
});

describe("the panel", () => {
  it("closes from its own header", async () => {
    renderWithProviders(<DocumentsSidebar mods={[]} />);

    await userEvent.click(screen.getByRole("button", { name: "Close documents" }));

    expect(useLibrarySidebarStore.getState().open).toBe(false);
  });

  it("switches tabs without losing the mod the readme tab holds", async () => {
    readme.mockResolvedValue(answers({ state: "present", text: "# Install me" }));
    useLibrarySidebarStore.setState({ modId: "a" });

    renderWithProviders(<DocumentsSidebar mods={[mod("a", "My Mod")]} />);
    const strip = screen.getByRole("tablist");
    await userEvent.click(within(strip).getByRole("tab", { name: "Licenses" }));
    await userEvent.click(within(strip).getByRole("tab", { name: "Readme" }));

    expect(await screen.findByRole("heading", { name: "Install me" })).toBeInTheDocument();
  });
});
