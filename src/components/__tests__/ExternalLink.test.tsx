// @vitest-environment happy-dom

import { open } from "@tauri-apps/plugin-shell";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ExternalLink, MarkdownView } from "@/components";

const opened = vi.mocked(open);

beforeEach(() => {
  opened.mockClear();
});

describe("ExternalLink", () => {
  it("hands a pressed link to the system rather than the webview", async () => {
    render(<ExternalLink href="https://leaguetoolkit.dev">Docs</ExternalLink>);

    await userEvent.click(screen.getByRole("link", { name: /Docs/ }));

    expect(opened).toHaveBeenCalledWith("https://leaguetoolkit.dev");
  });

  it("cancels the press for a scheme the system must not be handed", async () => {
    render(<ExternalLink href="file:///C:/Windows/System32">Local</ExternalLink>);

    await userEvent.click(screen.getByRole("link", { name: /Local/ }));

    expect(opened).not.toHaveBeenCalled();
  });

  it("still calls a caller's own press handler", async () => {
    const pressed = vi.fn();
    render(
      <ExternalLink href="https://leaguetoolkit.dev" onClick={pressed}>
        Docs
      </ExternalLink>,
    );

    await userEvent.click(screen.getByRole("link", { name: /Docs/ }));

    expect(pressed).toHaveBeenCalledOnce();
    expect(opened).toHaveBeenCalledOnce();
  });
});

describe("a link in a rendered document", () => {
  it("opens in the system browser", async () => {
    render(<MarkdownView text="[wiki](https://wiki.leaguetoolkit.dev/)" root={null} />);

    await userEvent.click(screen.getByRole("link", { name: /wiki/ }));

    expect(opened).toHaveBeenCalledWith("https://wiki.leaguetoolkit.dev/");
  });

  it("draws a relative href as text, because nothing sits beside the document", () => {
    render(<MarkdownView text="[secrets](../../secrets)" root={null} />);

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("secrets")).toBeInTheDocument();
  });
});
