import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { mockInvoke } from "@/test/mocks/tauri";

import { TokenDecoder } from "../TokenDecoder";
import { createMockIncidentToken, renderWithApp } from "./fixtures";

const TOKEN = "LTK1-eNpVjsEKgzAQRH9lyVkwEY3trdBLT4XSexCzNQE1kqQeiv_ejVLow8Ay7DJvpYwJ1B";

describe("TokenDecoder", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  /// The team reads a player's token in their own manager, so the card says
  /// where it came from and offers nothing to click, because the mods it
  /// names are on another machine.
  it("unfolds a token into a read-only card marked From a token", async () => {
    mockInvoke.mockImplementation((cmd: string, args: Record<string, unknown>) => {
      if (cmd === "decode_incident_token") {
        expect(args).toEqual({ token: TOKEN });
        return Promise.resolve({ ok: true, value: createMockIncidentToken() });
      }
      return Promise.resolve({ ok: true, value: null });
    });
    const user = userEvent.setup();
    renderWithApp(<TokenDecoder open onOpenChange={() => {}} />);

    await user.type(screen.getByLabelText("Token"), TOKEN);
    await user.click(screen.getByRole("button", { name: "Decode" }));

    expect(await screen.findByText("From a token")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Missing data" })).toBeInTheDocument();
    expect(screen.getByText("Likely")).toBeInTheDocument();
    expect(screen.getByText("Aatrox Justicar")).toBeInTheDocument();
    expect(screen.getByText("Aatrox.wad.client")).toBeInTheDocument();
    expect(screen.getByText("ALE-9B39AA45")).toBeInTheDocument();
    expect(screen.getByText("SEJ-9F31B5D0")).toBeInTheDocument();
    expect(screen.getByText("Interrupt, exit code -1073741819, crashpad ran")).toBeInTheDocument();
    expect(screen.getByText("4 archives redirected, 4 mods enabled")).toBeInTheDocument();
    expect(
      screen.getByText(/LTK Manager v1\.14\.0 · League 16\.16\.804\.9184/),
    ).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: "Disable" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy report" })).not.toBeInTheDocument();
  });

  it("says inline when the paste is not a token", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "decode_incident_token") {
        return Promise.resolve({
          ok: false,
          error: { code: "INVALID_INPUT", message: "not a token" },
        });
      }
      return Promise.resolve({ ok: true, value: null });
    });
    const user = userEvent.setup();
    renderWithApp(<TokenDecoder open onOpenChange={() => {}} />);

    await user.type(screen.getByLabelText("Token"), "hello");
    await user.click(screen.getByRole("button", { name: "Decode" }));

    await waitFor(() => {
      expect(screen.getByText("Not an LTK incident token.")).toBeInTheDocument();
    });
    expect(screen.queryByText("From a token")).not.toBeInTheDocument();
  });

  it("keeps Decode off until something is pasted", () => {
    renderWithApp(<TokenDecoder open onOpenChange={() => {}} />);

    expect(screen.getByRole("button", { name: "Decode" })).toBeDisabled();
  });
});
