// @vitest-environment happy-dom

import { screen, within } from "@testing-library/react";
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
  const licensed = mod("a", "Alpha", { name: "MIT", url: "https://opensource.org/mit" });

  beforeEach(() => {
    useLibrarySidebarStore.setState({ tab: "licenses", modId: "a" });
  });

  it("names the license the open mod declares, and links it", () => {
    licenseText.mockResolvedValue(answers({ state: "present", text: "MIT License" }));

    renderWithProviders(<DocumentsSidebar mods={[licensed]} />);

    expect(screen.getByText("MIT")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://opensource.org/mit" })).toBeInTheDocument();
  });

  it("reads the text out of that mod's own archive", async () => {
    licenseText.mockResolvedValue(answers({ state: "present", text: "MIT License\n\nAs is." }));

    renderWithProviders(<DocumentsSidebar mods={[licensed]} />);

    expect(await screen.findByText(/MIT License/)).toBeInTheDocument();
    expect(licenseText).toHaveBeenCalledWith("a");
  });

  /* The middle state is the common one, and telling it from silence is why
     three states are told apart rather than two. */
  it("says a mod names a license and ships no text for it", async () => {
    licenseText.mockResolvedValue(answers({ state: "absent" }));

    renderWithProviders(<DocumentsSidebar mods={[licensed]} />);

    expect(
      await screen.findByText("This mod names a license and ships no text for it"),
    ).toBeInTheDocument();
  });

  it("says so rather than reading as unlicensed when the archive will not open", async () => {
    licenseText.mockResolvedValue(answers({ state: "unreadable", reason: "not a zip" }));

    renderWithProviders(<DocumentsSidebar mods={[licensed]} />);

    expect(await screen.findByText(/its license cannot be read/)).toBeInTheDocument();
  });

  /* A name costs nothing, because it rides in the config a listing already
     opens. A text costs one archive mount, so a mod that names none is not
     worth opening an archive for. */
  it("mounts no archive for a mod that declares no license", () => {
    renderWithProviders(<DocumentsSidebar mods={[mod("a", "Alpha", null)]} />);

    expect(screen.getByText("No license declared")).toBeInTheDocument();
    expect(licenseText).not.toHaveBeenCalled();
  });

  it("follows the mod the panel holds rather than the whole library", () => {
    useLibrarySidebarStore.setState({ modId: "b" });
    licenseText.mockResolvedValue(answers({ state: "present", text: "GPL" }));

    renderWithProviders(
      <DocumentsSidebar mods={[licensed, mod("b", "Beta", { name: "GPL-3.0", url: null })]} />,
    );

    expect(screen.getByText("GPL-3.0")).toBeInTheDocument();
    expect(screen.queryByText("MIT")).toBeNull();
  });

  it("says how to open one when the panel holds no mod", () => {
    useLibrarySidebarStore.setState({ modId: null });

    renderWithProviders(<DocumentsSidebar mods={[licensed]} />);

    expect(screen.getByText("Open a mod from its card menu")).toBeInTheDocument();
    expect(licenseText).not.toHaveBeenCalled();
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
