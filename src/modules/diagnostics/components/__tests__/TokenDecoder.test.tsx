import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { mockInvoke } from "@/test/mocks/tauri";

import { TokenDecoder } from "../TokenDecoder";
import { createMockDecodedIncident, renderWithApp } from "./fixtures";

const TOKEN = "DIAG1-3gAVoXTOAcaLuqFtkwEOAKFnlBAQzQMkzSPgoXYGoU8BoW8BoXMBoWwBoWnDoVABoXIC";

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
        return Promise.resolve({ ok: true, value: createMockDecodedIncident() });
      }
      return Promise.resolve({ ok: true, value: null });
    });
    const user = userEvent.setup();
    renderWithApp(<TokenDecoder open onOpenChange={() => {}} />);

    await user.type(screen.getByLabelText("Token"), TOKEN);
    await user.click(screen.getByRole("button", { name: "Decode" }));

    expect(await screen.findByText("From a token")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: "Missing Game Data" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Game stopped")).toBeInTheDocument();
    expect(
      screen.getByText(/LTK Manager v1\.14\.0 · League 16\.16\.804\.9184 · .* · 12 s · Library/),
    ).toBeInTheDocument();
    expect(screen.getByText("Overlay live, eager scan, match")).toBeInTheDocument();
    expect(screen.getByText("4 archives redirected, 4 mods enabled")).toBeInTheDocument();
    expect(
      screen.getByText(/dll a150130f1a90dcc2 .* host cc714b6990a29678 .* stock/),
    ).toBeInTheDocument();
    expect(screen.getByText("stopped on the loading screen")).toBeInTheDocument();
    expect(
      screen.getByText("Interrupt, exit code 0xC0000005 STATUS_ACCESS_VIOLATION, crashpad ran"),
    ).toBeInTheDocument();
    expect(screen.getByText("Aatrox.wad.client")).toBeInTheDocument();
    expect(screen.getByText("Aatrox Justicar")).toBeInTheDocument();
    expect(screen.getByText("Stopped at step 52 of 64")).toBeInTheDocument();
    expect(screen.getByText("0x1a2b3c4d5e6f7081")).toBeInTheDocument();
    expect(screen.getByText("ALE-9B39AA45")).toBeInTheDocument();
    expect(screen.getByText("A file the game needed is in no mounted archive")).toBeInTheDocument();
    expect(screen.getByText("ALE-FFFFFFFF")).toBeInTheDocument();
    expect(screen.getByText("No reading in this build's table")).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: "Disable" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy report" })).not.toBeInTheDocument();
  });

  /// A token from a newer manager carries a verdict this build has no name
  /// for, and the backend still reads everything around it.
  it("reads a verdict it does not know by its number, with the failure beside it", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "decode_incident_token") {
        return Promise.resolve({
          ok: true,
          value: createMockDecodedIncident({
            verdict: null,
            verdictCode: 99,
            title: "Verdict 99",
            consequence: null,
            origin: "workshop",
            injected: false,
            overlay: "none",
            hostElevated: true,
            failure: "IO: Could not read x.wad.",
            phase: "unknown",
            lastLoadStep: null,
          }),
        });
      }
      return Promise.resolve({ ok: true, value: null });
    });
    const user = userEvent.setup();
    renderWithApp(<TokenDecoder open onOpenChange={() => {}} />);

    await user.type(screen.getByLabelText("Token"), TOKEN);
    await user.click(screen.getByRole("button", { name: "Decode" }));

    expect(
      await screen.findByRole("heading", { level: 3, name: "Verdict 99" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Game stopped")).not.toBeInTheDocument();
    expect(screen.getByText(/Workshop test/)).toBeInTheDocument();
    expect(
      screen.getByText("DLL never attached, eager scan, match, host elevated"),
    ).toBeInTheDocument();
    expect(screen.getByText("IO: Could not read x.wad.")).toBeInTheDocument();
    expect(screen.queryByText(/step .* of 64/)).not.toBeInTheDocument();
  });

  /// The backend says why a paste did not read, and it can tell a newer
  /// token from no token at all, so its sentence shows as it is.
  it("shows the backend's reason when the paste does not decode", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "decode_incident_token") {
        return Promise.resolve({
          ok: false,
          error: {
            code: "UNKNOWN",
            message: "This token is from a newer LTK Manager, format DIAG2. Update to read it.",
          },
        });
      }
      return Promise.resolve({ ok: true, value: null });
    });
    const user = userEvent.setup();
    renderWithApp(<TokenDecoder open onOpenChange={() => {}} />);

    await user.type(screen.getByLabelText("Token"), "DIAG2-abc");
    await user.click(screen.getByRole("button", { name: "Decode" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "This token is from a newer LTK Manager, format DIAG2. Update to read it.",
        ),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText("From a token")).not.toBeInTheDocument();
  });

  it("keeps Decode off until something is pasted", () => {
    renderWithApp(<TokenDecoder open onOpenChange={() => {}} />);

    expect(screen.getByRole("button", { name: "Decode" })).toBeDisabled();
  });
});
