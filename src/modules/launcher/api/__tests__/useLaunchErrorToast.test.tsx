import { act, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { ToastProvider } from "@/components";
import type { AppError, LauncherError } from "@/lib/tauri";

import { useLaunchErrorToast } from "../useLaunchErrorToast";

function wrapper({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}

function launchError(context: LauncherError | undefined, message = "launch failed"): AppError {
  return { code: "LAUNCHER", message, context };
}

async function show(error: AppError) {
  const { result } = renderHook(() => useLaunchErrorToast(), { wrapper });
  await act(async () => result.current(error));
}

describe("useLaunchErrorToast", () => {
  /// The code says only that a launch failed, so every remedy is chosen from
  /// the context's `kind`.
  it.each([
    [{ kind: "RIOT_CLIENT_NOT_FOUND", installsPath: "C:/x.json" }, "Can't find your Riot Client"],
    [{ kind: "RIOT_CLIENT_UNREACHABLE", reason: "HTTP 404" }, "Couldn't reach the Riot Client"],
    [{ kind: "SPAWN_FAILED", reason: "access denied" }, "Couldn't start the Riot Client"],
    [{ kind: "UNSUPPORTED_PLATFORM" }, "Launching isn't supported here"],
  ] as [LauncherError, string][])("reads the remedy off %o", async (context, title) => {
    await show(launchError(context));

    expect(screen.getByText(title)).toBeInTheDocument();
  });

  /// Riot's own answer is the remedy, so a refusal it names gets our wording
  /// and one it does not gets Riot's prose through unedited.
  it("answers a refusal Riot explained", async () => {
    await show(
      launchError({
        kind: "LAUNCH_REFUSED",
        riotErrorCode: "eula_not_accepted",
        message: "eula",
      }),
    );

    expect(screen.getByText("Riot's Terms of Service need accepting")).toBeInTheDocument();
  });

  it("passes a refusal it does not know through unedited", async () => {
    await show(
      launchError(
        { kind: "LAUNCH_REFUSED", riotErrorCode: "something_new", message: "x" },
        "The client said no.",
      ),
    );

    expect(screen.getByText("The Riot Client refused to launch League")).toBeInTheDocument();
    expect(screen.getByText("The client said no.")).toBeInTheDocument();
  });

  /// An error with no context at all still has to say something.
  it("falls back when there is no context", async () => {
    await show(launchError(undefined, "something went wrong"));

    expect(screen.getByText("Couldn't launch League")).toBeInTheDocument();
    expect(screen.getByText("something went wrong")).toBeInTheDocument();
  });
});
