import { MutationObserver } from "@tanstack/react-query";
import { vi } from "vitest";

import type { AppError } from "@/lib/bindings";

const reportUnhandledFailure = vi.fn();

vi.mock("@/components/Toast", () => ({ reportUnhandledFailure }));

const { createAppQueryClient } = await import("../query");

beforeEach(() => {
  reportUnhandledFailure.mockClear();
});

const failure: AppError = { code: "MOD_NOT_FOUND", modId: "kayn-edgelord" };

async function runFailingMutation(
  options: Record<string, unknown> = {},
  perCall?: Record<string, unknown>,
) {
  const client = createAppQueryClient();
  const observer = new MutationObserver(client, {
    mutationFn: () => Promise.reject(failure),
    retry: false,
    ...options,
  });
  await observer.mutate(undefined, perCall).catch(() => undefined);
}

it("reports a mutation that says nothing about its own failure", async () => {
  await runFailingMutation();

  expect(reportUnhandledFailure).toHaveBeenCalledWith(failure);
});

/* An onError that only rolls an optimistic update back leaves the reader with a
   silent snap-back, so it is not a declaration that the failure is reported. */
it("reports a mutation whose onError only rolls back", async () => {
  await runFailingMutation({ onError: () => undefined });

  expect(reportUnhandledFailure).toHaveBeenCalledWith(failure);
});

it("stays quiet when the mutation opts out through meta", async () => {
  await runFailingMutation({ meta: { silentError: true } });

  expect(reportUnhandledFailure).not.toHaveBeenCalled();
});

/* `mutate(vars, { onError })` lives on the observer, never on `mutation.options`,
   so meta is the only declaration the cache can read. */
it("reports a mutation the caller handles only per call", async () => {
  await runFailingMutation({}, { onError: () => undefined });

  expect(reportUnhandledFailure).toHaveBeenCalledWith(failure);
});
