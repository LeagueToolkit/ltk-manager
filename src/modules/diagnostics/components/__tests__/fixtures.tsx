import { QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

import { ToastProvider } from "@/components";
import type { DecodedIncident, Incident } from "@/lib/tauri";
import { createTestQueryClient } from "@/test/utils";

/** A clock on the given local day, so a fixture lands in the day a test names. */
export function onDay(daysAgo: number, hour = 12, minute = 0): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

export function createMockIncident(overrides?: Partial<Incident>): Incident {
  return {
    id: "2026-08-21T21-14-02",
    startedAt: "2026-08-21T19:13:50Z",
    endedAt: "2026-08-21T19:14:02Z",
    origin: { kind: "library" },
    injected: true,
    hostElevated: false,
    patcher: {
      dll: { hash: "a150130f1a90dcc2", built: 0x6a8301ab },
      host: { hash: "cc714b6990a29678", built: 0x6a8301d1 },
      matchesBundle: true,
    },
    overlay: "live",
    overlayDetail: null,
    redirected: ["Aatrox.wad.client", "Map11.wad.client"],
    skipped: [],
    enabledCount: 2,
    launch: "match",
    scan: "eager",
    scanStatus: null,
    phase: "loading",
    failure: null,
    game: {
      version: "16.16.804.9184",
      contentVersion: "16.16.1",
      logPath: "C:\\Riot Games\\League of Legends\\Logs\\GameLogs\\x\\x_r3dlog.txt",
    },
    ending: { exitReason: "Interrupt", exitCode: -1073741819, crashed: true },
    verdict: {
      kind: "missing-data",
      title: "Missing Game Data",
      cause: "League failed to read a file.",
      subject: "assets/characters/aatrox/skins/skin12/aatrox_skin12_tx_cm.dds",
      consequence: "game-stopped",
      titleOverride: null,
      hints: ["A mod that references a file it does not ship crashes the read."],
    },
    evidence: [
      {
        at: "00:12.3",
        source: "game",
        line: "ALE-9B39AA45 FATAL ERROR. Missing data: 0x1a2b3c4d5e6f7081",
        code: {
          id: "ALE-9B39AA45",
          kind: "missing_data",
          meaning: "A file the game needed is in no mounted archive",
          mark: "confirmed",
        },
      },
      {
        at: "00:12.4",
        source: "client",
        line: "Interrupt, exit code -1073741819",
        code: null,
      },
    ],
    suspects: [
      {
        modId: "mod-aatrox",
        projectPath: null,
        displayName: "Aatrox Justicar",
        because: "writes Aatrox.wad.client, which holds the path",
      },
    ],
    dismissed: false,
    ...overrides,
  };
}

export function createMockDecodedIncident(overrides?: Partial<DecodedIncident>): DecodedIncident {
  return {
    endedAt: "2026-08-21T19:14:00+00:00",
    manager: "1.14.0",
    game: "16.16.804.9184",
    verdict: "missing-data",
    verdictCode: 6,
    title: "Missing Game Data",
    consequence: "game-stopped",
    origin: "library",
    overlay: "live",
    scan: "eager",
    launch: "match",
    injected: true,
    hostElevated: false,
    phase: "loading",
    ending: { exitReason: "Interrupt", exitCode: -1073741819, crashed: true },
    durationSecs: 12,
    codes: [
      {
        id: "ALE-9B39AA45",
        kind: "missing_data",
        meaning: "A file the game needed is in no mounted archive",
        mark: "confirmed",
      },
      { id: "ALE-FFFFFFFF", kind: null, meaning: null, mark: null },
    ],
    lastLoadStep: 52,
    missingHash: "1a2b3c4d5e6f7081",
    subject: "Aatrox.wad.client",
    suspects: ["Aatrox Justicar"],
    skipped: [],
    redirectedCount: 4,
    enabledCount: 4,
    dll: { hash: "a150130f1a90dcc2", built: "2026-08-17T12:42:19+00:00" },
    host: { hash: "cc714b6990a29678", built: "2026-08-17T12:42:57+00:00" },
    patcherOk: true,
    scanStatus: null,
    scanStatusCode: null,
    failure: null,
    overlayDetail: null,
    ...overrides,
  };
}

function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

/** Renders with the query client and the toast manager the detail's actions need. */
export function renderWithApp(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) {
  return render(ui, { wrapper: AppProviders, ...options });
}
