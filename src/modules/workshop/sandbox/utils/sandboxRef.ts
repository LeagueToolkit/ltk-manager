import type { SandboxRef } from "@/lib/tauri";

/** The installed game alone, which is read-only. ADR-0056. */
export const GAME_SANDBOX: SandboxRef = { kind: "game" };

/** Every layer of the project at `project` over the game. */
export function projectSandbox(project: string): SandboxRef {
  return { kind: "project", project };
}

/** What identifies a sandbox, for a query key. */
export function sandboxKey(sandbox: SandboxRef): string {
  if (sandbox.kind === "game") return "game";
  if (sandbox.kind === "project") return `project:${sandbox.project}`;
  return `layers:${sandbox.project}:${sandbox.layers.join("/")}`;
}

/** The layer a project's layer table holds, as far as build order reads it. */
interface OrderedLayer {
  readonly name: string;
  readonly priority: number;
}

/** Sorts `layers` into build order, which mirrors `ModProjectLayer::apply_order`. */
export function inBuildOrder<L extends OrderedLayer>(layers: readonly L[]): readonly L[] {
  return [...layers].sort(
    (a, b) =>
      Number(b.name === "base") - Number(a.name === "base") ||
      a.priority - b.priority ||
      a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
}

/**
 * The sandbox after `layer` is switched `on`, where `all` is the project's layers in build order.
 *
 * Every layer chosen returns the project's sandbox, which is the sandbox that takes edits.
 */
export function withLayerChosen(
  sandbox: SandboxRef,
  project: string,
  all: readonly string[],
  layer: string,
  on: boolean,
): SandboxRef {
  const chosen = sandbox.kind === "layers" ? sandbox.layers : all;
  const layers = all.filter((name) => (name === layer ? on : chosen.includes(name)));
  if (layers.length === all.length) return projectSandbox(project);

  return { kind: "layers", project, layers };
}

export function sameSandbox(a: SandboxRef, b: SandboxRef): boolean {
  return sandboxKey(a) === sandboxKey(b);
}

/** The project a sandbox reads, or null for the game. */
export function sandboxProject(sandbox: SandboxRef): string | null {
  return sandbox.kind === "game" ? null : sandbox.project;
}
