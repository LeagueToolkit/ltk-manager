// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import type { ShownAdvisory } from "@/lib/tauri";
import { commandNames } from "@/test/commandNames";
import { mockInvoke } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/utils";

import { useAdvisories } from "../../api";
import { AdvisoryBadge } from "../AdvisoryBadge";

const MOD_ID = "aatrox-justicar";

function advisory(over: Partial<ShownAdvisory> = {}): ShownAdvisory {
  return {
    code: "layers-unset",
    tier: null,
    subject: { kind: "mod", id: MOD_ID },
    patcherCode: null,
    source: "build",
    at: "2026-11-15T14:02:00Z",
    muted: false,
    ...over,
  };
}

function mockAdvisories(advisories: ShownAdvisory[]) {
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === commandNames.diagnostics.listAdvisories) {
      return Promise.resolve({ ok: true, value: advisories });
    }
    return Promise.resolve({ ok: true, value: null });
  });
}

/** Reports when the advisory list has loaded, so an absence can be asserted. */
function Probe() {
  const { isSuccess } = useAdvisories();
  return <span data-testid={isSuccess ? "advisories-ready" : "advisories-pending"} />;
}

async function renderBadge(badge: ReactElement) {
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <Probe />
      {badge}
    </QueryClientProvider>,
  );
  await screen.findByTestId("advisories-ready");
}

describe("AdvisoryBadge", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("marks a mod that an advisory is about", async () => {
    mockAdvisories([advisory(), advisory({ code: "locale-missing" })]);
    await renderBadge(<AdvisoryBadge modId={MOD_ID} />);

    expect(screen.getByLabelText("2 advisories")).toBeInTheDocument();
  });

  it("marks a workshop project by its path", async () => {
    const path = "X:\\projects\\aatrox-justicar";
    mockAdvisories([advisory({ subject: { kind: "project", path } })]);
    await renderBadge(<AdvisoryBadge projectPath={path} />);

    expect(screen.getByLabelText("1 advisory")).toBeInTheDocument();
  });

  it("renders nothing for a muted advisory, another mod and a disabled mod", async () => {
    mockAdvisories([
      advisory({ muted: true }),
      advisory({ subject: { kind: "mod", id: "disabled" } }),
    ]);
    await renderBadge(
      <>
        <AdvisoryBadge modId={MOD_ID} />
        <AdvisoryBadge modId="someone-else" />
        <AdvisoryBadge modId="disabled" enabled={false} />
      </>,
    );

    expect(screen.queryByLabelText(/advisor/)).not.toBeInTheDocument();
  });
});
